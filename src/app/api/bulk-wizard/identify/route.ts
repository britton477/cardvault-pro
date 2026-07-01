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
const SYSTEM_PROMPT = `You are an expert Pokémon TCG card identifier. Given a photo of a Pokémon card, extract the following fields and return ONLY valid JSON with no markdown, no explanation, no surrounding text:

{
  "card_name":   "<name printed at the top of the card — e.g. 'Charizard', 'Pikachu ex', 'Misty\\'s Psyduck'>",
  "set_code":    "<3–6 character set abbreviation — read the TEXT printed near the bottom of the card, not just the graphic symbol>",
  "card_number": "<ONLY the digits/text BEFORE the slash — e.g. if card reads '025/198' output '025'; if '006/165' output '006'; if 'TG01/TG30' output 'TG01' — leave empty if not visible>",
  "condition":   "<NM | LP | MP | HP>",
  "foil_type":   "<Normal | Holo | Reverse Holo | Full Art | Secret Rare | Special Illustration Rare | Hyper Rare | Illustration Rare>",
  "language":    "<EN | JP | DE | FR | ES | IT | PT | KO | ZH>",
  "confidence":  <0.0–1.0 float>
}

HOW TO FIND THE SET CODE (critical — read carefully):
On modern Pokémon cards (Sword & Shield era onward), the set code is PRINTED AS TEXT near the bottom of the card — usually bottom-left, next to or below the set symbol graphic. It is a short abbreviation like "SVI", "PAL", "TWM", etc.
- DO NOT guess the code from the symbol shape alone. READ the printed letters.
- The printed text near the bottom-left info line will contain the code. Look for 2–6 uppercase letters grouped together, e.g. "SVI 025/198" or "PAL 006/165".
- If you can read "SVI" in that area → set_code = "SVI". If you see "PAL" → "PAL". Etc.
- Only fall back to symbol-matching if you truly cannot read any printed letters.

Known set codes by era (for reference when reading is ambiguous):
- Scarlet & Violet: SVI, PAL, OBF, MEW, PAF, TEF, TWM, SFA, SCR, SSP, PRE, JTG
- Sword & Shield: SSH, RCL, DAA, VIV, SHF, BST, CRE, EVS, FST, BRS, ASR, LOR, SIT, CRZ, CEL, PGO
- Sun & Moon: SUM, GRI, BUS, CIN, UPR, FLI, CES, LOT, TEU, DRM, UNM, UNB, HIF, CEC
- XY era: XY, FLF, FFI, PHF, PRC, ROS, AOR, BKT, BKP, FCO, STS, EVO, STS
- Leave empty string ONLY if the bottom of the card is completely obscured.

HOW TO FIND THE CARD NUMBER:
- Look at the bottom area of the card. The number appears as "NNN/TTT" (e.g. "025/198").
- Output ONLY the part BEFORE the slash: "025" not "025/198".
- For promo or special cards it may be "SM01", "SWSH001", "TG01/TG30" → output "TG01".
- Do NOT output the set total (the number after the slash).

Condition grading:
- NM: No visible wear — edges crisp, surface clean. DEFAULT for cards that look undamaged.
- LP: Minor edge whitening on 1–2 corners, very faint scratches. Must be clearly visible.
- MP: Obvious edge wear on multiple corners, noticeable scratches or scuffs.
- HP: Severe wear, creases, heavy scratching, or bent corners.
→ Default to NM unless you can clearly see damage.

Additional rules:
- card_name must be the English name even if the card is in another language
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
        max_tokens: 400,
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
