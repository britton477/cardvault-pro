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
  /** Raw base64 JPEG (no data:// prefix). Max ~400KB after client resize to 1200px. */
  image:      z.string().min(100).max(600_000),
  /** When set, skip AI set detection and inject this value directly. */
  set_code:   z.string().max(20).optional(),
  /**
   * When true, use the retro-mode prompt which identifies sets by card
   * symbol / design rather than printed text code.
   * Covers WOTC era through Black & White (1999–2013).
   */
  retro_mode: z.boolean().optional(),
})

// Structured extraction prompt — instructs the model to return JSON only.
// Deliberately terse to keep token count low (haiku pricing is per-token).
const SYSTEM_PROMPT = `You are an expert Pokémon TCG card identifier. Given a photo of a Pokémon card, extract the following fields and return ONLY valid JSON with no markdown, no explanation, no surrounding text:

{
  "card_name":   "<name printed at the top of the card — e.g. 'Charizard', 'Pikachu ex', 'Misty\\'s Psyduck'>",
  "set_code":    "<3–6 character set abbreviation — see HOW TO FIND THE SET CODE below>",
  "card_number": "<see HOW TO FIND THE CARD NUMBER below>",
  "condition":   "<NM | LP | MP | HP> — DEFAULT IS ALWAYS NM unless damage is unmistakeable",
  "foil_type":   "<Normal | Holo | Reverse Holo | Full Art | Secret Rare | Special Illustration Rare | Hyper Rare | Illustration Rare>",
  "language":    "<EN | JP | DE | FR | ES | IT | PT | KO | ZH>",
  "confidence":  <0.0–1.0 float>
}

═══ HOW TO FIND THE SET CODE ══════════════════════════════════════════
On modern Pokémon cards the bottom-left info line follows this pattern:
  SET_CODE  LANG_CODE  CARD_NUMBER/SET_TOTAL

Concrete examples of what you will see printed on actual cards:
  "JTG EN  181/159"   →  set_code="JTG",  language="EN",  card_number="181"
  "SVI EN  025/198"   →  set_code="SVI",  language="EN",  card_number="025"
  "PAL JP  006/165"   →  set_code="PAL",  language="JP",  card_number="006"
  "TWM EN  TG01/TG30" →  set_code="TWM",  language="EN",  card_number="TG01"

CRITICAL RULES:
1. The short ALL-CAPS code printed BEFORE the language indicator is the set_code.
2. Do NOT include the language letters (EN/JP/DE…) in set_code — they are a SEPARATE field.
3. Read the PRINTED TEXT. Do NOT guess or infer from the card symbol/graphic alone.
4. IMPORTANT: If the set code text is too small to read with certainty, return "" (empty string).
   A wrong set code corrupts inventory data. "SVI" or "PAL" as a guess is worse than "".
   Only use the known codes list below if you can partially read the letters and are matching them.

Known set codes for disambiguation when text is partially legible:
Scarlet & Violet (2023–2025): SVI, PAL, OBF, MEW, PAF, TEF, TWM, SFA, SCR, SSP, PRE, JTG
Sword & Shield (2020–2023):   SSH, RCL, DAA, VIV, SHF, BST, CRE, EVS, FST, BRS, ASR, LOR, SIT, CRZ, CEL, PGO
Sun & Moon (2017–2019):       SUM, GRI, BUS, CIN, UPR, FLI, CES, LOT, TEU, DRM, UNM, UNB, HIF, CEC
XY (2014–2016):               XY, FLF, FFI, PHF, PRC, ROS, AOR, BKT, BKP, FCO, STS, EVO

═══ HOW TO FIND THE CARD NUMBER ══════════════════════════════════════
The number appears as "NNN/TTT" — output the FULL string including the set total.
• "181/159" → "181/159"  (a number ABOVE the set total is valid — these are secret/illustration rares)
• "025/198" → "025/198"
• "TG01/TG30" → "TG01/TG30"
• "SWSH001" has no slash — output "SWSH001" as-is
If the number is not clearly legible, return "" — do NOT guess.

═══ CONDITION ════════════════════════════════════════════════════════
THE DEFAULT IS ALWAYS NM. Only downgrade if you can CLEARLY AND UNMISTAKEABLY see damage:
- NM (Near Mint): No visible wear — crisp edges, clean surface. ← USE THIS BY DEFAULT
- LP (Lightly Played): Visible whitening on 1–2 corners or light scratches — must be clearly visible
- MP (Moderately Played): Heavy edge wear on multiple corners, prominent scratches or scuffs
- HP (Heavily Played): Creases, deep scratching, or bent/damaged corners
WHEN IN DOUBT → always output "NM". Glare or slight reflection on a sleeved card is NOT damage.

Additional rules:
- card_name must be the English name even if the card is in another language
- If you cannot identify the card at all, set confidence to 0.1 and card_name to "Unknown"
- Never output anything outside the JSON object`

// =============================================================================
// RETRO MODE — for cards without a printed set code (WOTC era through BW)
//
// Identifies the set from the card's symbol graphic, overall design, and the
// set-total in the card number (e.g. "/102" is almost uniquely Base Set).
// Foil terminology also differs: Holo / Reverse Holo / Normal.
// =============================================================================
const RETRO_SYSTEM_PROMPT = `You are an expert Pokémon TCG card identifier specialising in vintage and retro sets (1999–2013).

IMPORTANT: These cards do NOT have a printed set code text at the bottom. Identify the set from:
1. The SET SYMBOL graphic (small icon near the HP bar or bottom of the card)
2. The set total in the card number (e.g. "/102" = Base Set, "/64" = Jungle, "/62" = Fossil)
3. Overall card design, border style, and font characteristics

Return ONLY valid JSON with no markdown, no explanation:

{
  "card_name":   "<English name at top of card>",
  "set_code":    "<use the symbol/design table below>",
  "card_number": "<FULL number including set total — '4/102' from '4/102', '25/64' from '25/64'>",
  "condition":   "<NM | LP | MP | HP> — DEFAULT IS NM",
  "foil_type":   "<Holo | Reverse Holo | Normal>",
  "language":    "<EN | JP | DE | FR | ES | IT | PT | KO | ZH>",
  "confidence":  <0.0–1.0 float>
}

═══ SET IDENTIFICATION ════════════════════════════════════════════════

WOTC Era (1999–2003) — identify by symbol AND set total:
  No symbol (solid black border, no icon),  /102 cards → "BASE"    Base Set
  No symbol, different card back design,    /130 cards → "B2"     Base Set 2
  Leaf / plant silhouette,                  /64 cards  → "JU"     Jungle
  Fossil / bone silhouette,                 /62 cards  → "FO"     Fossil
  Stylised rocket "R",                      /82 cards  → "TR"     Team Rocket
  Single hexagonal gym badge,               /132 cards → "GH"     Gym Heroes
  Two stacked hexagonal gym badges,         /132 cards → "GC"     Gym Challenge
  Shooting star / comet,                    /111 cards → "N1"     Neo Genesis
  Magnifying glass / hourglass,             /75 cards  → "N2"     Neo Discovery
  Compass rose / starburst,                 /66 cards  → "N3"     Neo Revelation
  Crystal / gem,                            /105 cards → "N4"     Neo Destiny
  Globe with decorative "L",                /110 cards → "LC"     Legendary Collection
  Swirl / wave pattern,                     /165 cards → "EXP"    Expedition Base Set
  Water drop / teardrop,                    /186 cards → "AQ"     Aquapolis
  Mountain peak / geometric crystal,        /182 cards → "SKY"    Skyridge

EX Era (2003–2007) — Poké Ball variations with set colours:
  Red/blue Poké Ball,   /109 → "RS"   EX Ruby & Sapphire
  Sandy/brown swirl,    /100 → "SS"   EX Sandstorm
  Dragon claw/wing,     /97  → "DR"   EX Dragon
  Stylised M/A badge,   /95  → "MA"   EX Team Magma vs Aqua
  Triangle/pyramid,     /101 → "HL"   EX Hidden Legends
  Fire/Leaf badge,      /116 → "FRL"  EX FireRed & LeafGreen
  DNA helix/pentagon,   /107 → "DX"   EX Deoxys
  Green leaf swirl,     /106 → "EM"   EX Emerald
  Gold starburst,       /115 → "UF"   EX Unseen Forces
  Greek delta Δ,        /113 → "DS"   EX Delta Species
  Hammer/anvil,         /92  → "LM"   EX Legend Maker
  Atom/orbital rings,   /110 → "HP"   EX Holon Phantoms
  Hexagonal crystal,    /100 → "CG"   EX Crystal Guardians
  Curved dragon wings,  /101 → "DF"   EX Dragon Frontiers
  Poké Ball with crown, /108 → "PK"   EX Power Keepers

Diamond & Pearl Era (2007–2009):
  Diamond/pearl gem,    /130 → "DP"   Diamond & Pearl
  Treasure chest,       /123 → "MT"   Mysterious Treasures
  Wishing star,         /132 → "SW"   Secret Wonders
  Floral Poké Ball,     /106 → "GE"   Great Encounters
  Sun/dawn rays,        /100 → "MD"   Majestic Dawn
  Torch/flame,          /146 → "LA"   Legends Awakened
  Snowflake/storm,      /100 → "SF"   Stormfront

Platinum Era (2009):
  Platinum shield,      /127 → "PL"   Platinum
  Double crown,         /120 → "RR"   Rising Rivals
  Trophy cup,           /147 → "SV"   Supreme Victors
  Arceus halo/wheel,    /99  → "AR"   Arceus

HeartGold & SoulSilver Era (2010–2011):
  Gold/silver ball,     /123 → "HS"   HeartGold & SoulSilver
  Burst/explosion,      /95  → "UL"   Unleashed
  Shield/fort,          /91  → "UD"   Undaunted
  Fanfare/trumpet,      /102 → "TM"   Triumphant
  Ringing bell,         /95  → "CL"   Call of Legends

Black & White Era (2011–2013):
  Yin-yang/BW spiral,   /115 → "BW"   Black & White
  Gear/cog,             /98  → "EPO"  Emerging Powers
  Crown/noble,          /101 → "NVI"  Noble Victories
  Comet/shooting star,  /99  → "NXD"  Next Destinies
  Dark shadow symbol,   /108 → "DEX"  Dark Explorers
  BW dragon wings,      /128 → "DRX"  Dragons Exalted
  Ice crystal/fence,    /153 → "BCR"  Boundaries Crossed
  Plasma lightning,     /135 → "PLS"  Plasma Storm
  Frozen bolt,          /122 → "PLF"  Plasma Freeze
  Plasma blast ring,    /105 → "PLB"  Plasma Blast
  Laurel wreath trophy, /113 → "LTR"  Legendary Treasures

═══ FOIL TYPE (retro terminology) ═══════════════════════════════════
- "Holo":         Holographic sparkle in the artwork area ONLY (the window behind the Pokémon)
- "Reverse Holo": Holographic sparkle on the card BORDER/FRAME (not the artwork)
- "Normal":       No holographic elements (commons, uncommons, and non-holo rares)

═══ CONDITION ════════════════════════════════════════════════════════
DEFAULT TO NM. Only downgrade if damage is CLEARLY visible:
- NM: Crisp edges/corners, no whitening, clean surface
- LP: Light whitening on 1-2 corners — must be clearly visible
- MP: Whitening on multiple corners, visible scratches
- HP: Creases, heavy wear, bent or damaged corners
Retro cards commonly have minor edge wear from age — only downgrade if damage is unmistakeable.

Additional rules:
- card_name must be the English name (even for Japanese or other language cards)
- If you cannot identify the set, return your best guess and set confidence below 0.5
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

    // Retro mode uses a separate prompt tuned for symbol-based set detection
    const systemPrompt = input.retro_mode ? RETRO_SYSTEM_PROMPT : SYSTEM_PROMPT

    // User message: if a set code is locked, anchor the model to it
    const userText = input.set_code
      ? `Identify this card. The set code is confirmed as "${input.set_code}" — use it as-is, do not override it.`
      : input.retro_mode
        ? 'Identify this retro Pokémon card. Use the set symbol, set total in the card number, and card design to determine the set.'
        : 'Identify this card.'

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
          { type: 'text', text: userText },
        ],
      },
    ]

    // claude-sonnet-4-6 is used here rather than haiku because reading the tiny
    // printed set code and card number at the bottom of a card requires reliable
    // small-text OCR. Sonnet is meaningfully better at this; the cost difference
    // (~$0.005 vs $0.002 per card) is acceptable for a business inventory tool.
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 400,
        system:     systemPrompt,
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
