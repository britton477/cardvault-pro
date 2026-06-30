// =============================================================================
// POST /api/bulk-wizard/identify
//
// Accepts a base64-encoded card image and returns AI-identified card details.
//
// Pipeline:
//   1. Validate input (base64 string, optional locked set_code)
//   2. Send to Anthropic claude-haiku-4-5 via vision messages API
//   3. Parse structured JSON response
//   4. Return { card_name, set_code, card_number, condition, foil_type,
//               language, confidence }
//
// Security:
//   - Requires auth (org-scoped)
//   - Rate limited: 30 req/min per org (Anthropic cost control)
//   - Image data is NEVER stored — processed in memory and discarded
//
// Performance:
//   - claude-haiku-4-5 is the fastest/cheapest Claude model, ideal for this
//   - Client pre-resizes images to ≤800px before sending (~50× smaller payload)
// =============================================================================
import { type NextRequest } from 'next/server'
import { z, ZodError }      from 'zod'
import { requireAuth, ok, serverError, validationError, badRequest } from '@/lib/api'
import { rateLimit, tooManyRequests } from '@/lib/rate-limit'

const BodySchema = z.object({
  /** Raw base64 JPEG (no data:// prefix). Max ~200KB after client resize. */
  image:    z.string().min(100).max(300_000),
  /** When set, skip AI set detection and inject this value directly. */
  set_code: z.string().max(20).optional(),
})

// Structured extraction prompt — instructs the model to return JSON only.
// Deliberately terse to keep token count low (haiku pricing is per-token).
const SYSTEM_PROMPT = `You are a Pokémon trading card expert. Given a photo of a card, extract the following fields and return ONLY valid JSON with no markdown, no explanation:

{
  "card_name":   "<name printed on the card, English>",
  "set_code":    "<set symbol code, e.g. SV01, CRI, OBF — leave empty string if unclear>",
  "card_number": "<number printed bottom-right, e.g. 025/198 or 025 — leave empty string if unclear>",
  "condition":   "<NM | LP | MP | HP — your best visual assessment>",
  "foil_type":   "<Normal | Holo | Reverse Holo | Full Art | Secret Rare | Special Illustration Rare | Hyper Rare>",
  "language":    "<EN | JP | DE | FR | ES | IT | PT | KO | ZH>",
  "confidence":  <0.0–1.0 float, how certain you are of the card_name>
}

Rules:
- card_name must be the English card name even if the card is in another language
- If you cannot identify the card at all, set confidence to 0.1 and card_name to "Unknown"
- Never output anything outside the JSON object`

export async function POST(request: NextRequest) {
  try {
    const { orgId } = await requireAuth()

    // Rate limit: 30 identify requests per minute per org
    const limit = await rateLimit(request, `bulk-identify:${orgId}`, { max: 30, window: '1m' })
    if (!limit.success) return tooManyRequests()

    const body  = await request.json() as unknown
    const input = BodySchema.parse(body)

    // ── Anthropic API call ────────────────────────────────────────────────────
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) return serverError(new Error('Anthropic API key not configured'))

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type:       'base64',
              media_type: 'image/jpeg',
              data:       input.image,
            },
          },
          {
            type: 'text',
            text: input.set_code
              ? `Identify this card. The set code is confirmed as "${input.set_code}" — use it as-is, do not override it.`
              : 'Identify this card.',
          },
        ],
      },
    ]

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system:     SYSTEM_PROMPT,
        messages,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[BulkWizard/identify] Anthropic error:', res.status, text)
      return serverError(new Error(`Vision API error: ${res.status}`))
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>
    }

    const raw = data.content.find(b => b.type === 'text')?.text?.trim() ?? ''

    // ── Parse JSON from model output ──────────────────────────────────────────
    // The model is instructed to return only JSON, but defensively strip any
    // accidental markdown fences before parsing.
    const jsonStr = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonStr) as Record<string, unknown>
    } catch {
      console.error('[BulkWizard/identify] Failed to parse model JSON:', raw)
      return badRequest('Card could not be identified — model returned invalid JSON')
    }

    // ── Validate + normalise the parsed fields ────────────────────────────────
    const card_name   = String(parsed['card_name']   ?? '').trim()
    const set_code    = input.set_code ?? String(parsed['set_code']   ?? '').trim().toUpperCase()
    const card_number = String(parsed['card_number'] ?? '').trim()
    const foil_type   = String(parsed['foil_type']   ?? 'Normal').trim()
    const language    = String(parsed['language']    ?? 'EN').trim().toUpperCase()
    const confidence  = Math.min(1, Math.max(0, Number(parsed['confidence'] ?? 0.5)))

    // Normalise condition to our enum values
    const rawCond  = String(parsed['condition'] ?? 'NM').toUpperCase()
    const condMap: Record<string, string> = { NM: 'NM', LP: 'LP', MP: 'MP', HP: 'HP' }
    const condition = condMap[rawCond] ?? 'NM'

    return ok({
      card_name,
      set_code,
      card_number,
      condition,
      foil_type,
      language,
      confidence,
    })
  } catch (err) {
    if (err instanceof ZodError)  return validationError(err)
    if (err instanceof Response)  return err
    return serverError(err)
  }
}
