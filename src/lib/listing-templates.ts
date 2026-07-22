// =============================================================================
// CardVault Pro — eBay listing description templates
//
// Set listings share one description across every card in them, so the copy is
// written once and reused. The org can override it in Settings; this file holds
// the default and the token substitution.
//
// Tokens are deliberately few. A template with many placeholders becomes a
// small programming language nobody wants to learn — these are the only parts
// that genuinely change between listings.
// =============================================================================

/** Tokens a template may contain. */
export interface TemplateTokens {
  /** Set or group name, e.g. "SCARLET & VIOLET BLACK STAR PROMOS" */
  set: string
  /** Condition applied at listing level, e.g. "Near Mint" */
  condition: string
  /** Shop name from org settings */
  shop: string
}

/**
 * Default set listing description.
 *
 * Structure is deliberate:
 *   - Combined postage sits high, because on a multi-variation listing it is
 *     the single line most likely to turn a one-card sale into a five-card one.
 *   - Condition is stated plainly rather than hedged, which reduces disputes.
 *   - Dispatch and packaging specifics cut down "when will it arrive" messages.
 *
 * Contains no external links or contact details — both breach eBay policy.
 */
export const DEFAULT_SET_LISTING_TEMPLATE = `{SET} — PICK YOUR CARD

Select the card you want from the dropdown above. Every card listed is in stock and ready to post — quantities update live, so if it's showing, I have it.

CONDITION
All cards are {CONDITION} unless stated otherwise.
Pulled from sealed product, sleeved on opening, and stored in a hard case.

BUYING MORE THAN ONE?
Add as many cards as you like to your basket and pay postage once.
Combined postage is applied automatically at checkout. Building a set is exactly what this listing is for.

POSTAGE
- Posted within 1 working day of cleared payment
- Sleeved and top-loaded
- Plain, sturdy outer packaging
- Royal Mail 2nd Class as standard, tracked on higher-value orders

100% genuine Pokémon cards. No proxies, no reprints, no fakes.
Bought, opened and packed by me here in the UK.

Questions about a specific card, or after something not shown?
Send me a message — happy to help.`

/** Full condition names — buyers read these, not the two-letter codes. */
const CONDITION_NAMES: Record<string, string> = {
  NM:     'Near Mint',
  LP:     'Lightly Played',
  MP:     'Moderately Played',
  HP:     'Heavily Played',
  Sealed: 'Sealed',
}

export function conditionName(code: string): string {
  return CONDITION_NAMES[code] ?? code
}

/**
 * Substitute tokens into a template.
 *
 * Unknown tokens are left untouched rather than blanked — a visible {TYPO} in
 * the preview tells the user their template is wrong, whereas silently emptying
 * it would ship a broken description to eBay unnoticed.
 */
export function renderTemplate(template: string, tokens: TemplateTokens): string {
  return template
    .replace(/\{SET\}/g,       tokens.set)
    .replace(/\{CONDITION\}/g, tokens.condition)
    .replace(/\{SHOP\}/g,      tokens.shop)
}

/**
 * Build a set listing description.
 *
 * @param template Org override, or null/empty to use the built-in default
 */
export function buildSetListingDescription(
  template: string | null | undefined,
  opts: { setName: string; condition: string; shopName?: string },
): string {
  const base = template && template.trim().length > 0
    ? template
    : DEFAULT_SET_LISTING_TEMPLATE

  return renderTemplate(base, {
    set:       opts.setName.toUpperCase(),
    condition: conditionName(opts.condition),
    shop:      opts.shopName ?? '',
  })
}

// ── Plain text → eBay HTML ────────────────────────────────────────────────────
//
// eBay renders descriptions as HTML, so a plain-text template arrives as one
// unbroken paragraph — every newline collapses and the listing reads as a wall
// of text.
//
// Rather than making the user write HTML in a textarea, the template stays
// plain text and gains structure here. Styling matches buildListingDescription()
// so single-card and set listings look like the same shop.
//
// Structure is inferred from how people naturally write:
//   first line          → listing heading
//   an ALL-CAPS line    → section heading, with a rule above it
//   lines beginning "-" → bullet list
//   anything else       → paragraph, with single newlines kept as line breaks

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** A heading is a line whose letters are all uppercase — "POSTAGE", "CONDITION". */
function isHeading(line: string): boolean {
  const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '')
  return letters.length > 0 && letters === letters.toUpperCase() && line.length <= 70
}

const HR = '<hr style="border: none; border-top: 1px solid #ddd; margin: 14px 0;" />'

export function plainTextToEbayHtml(text: string, shopName?: string): string {
  const blocks = text.trim().split(/\n\s*\n/)
  const out: string[] = []
  let headingsSeen = 0

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) continue

    const [first, ...rest] = lines

    if (first && isHeading(first)) {
      if (headingsSeen === 0) {
        // Listing heading, plus the shop line beneath it
        out.push(`<h2 style="font-size: 18px; margin: 0 0 4px;">${escapeHtml(first)}</h2>`)
        if (shopName) {
          out.push(`<p style="color: #555; margin: 0 0 12px;">${escapeHtml(shopName)} &mdash; UK Pok&eacute;mon Card Seller</p>`)
        }
      } else {
        out.push(HR)
        out.push(`<h3 style="font-size: 14px; margin: 0 0 6px;">${escapeHtml(first)}</h3>`)
      }
      headingsSeen++

      if (rest.length > 0) out.push(renderBody(rest))
      continue
    }

    out.push(renderBody(lines))
  }

  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222; max-width: 680px;">
${out.join('\n')}
</div>`
}

/** Render non-heading lines: bullets become a list, everything else a paragraph. */
function renderBody(lines: string[]): string {
  const bullets = lines.filter(l => l.startsWith('-'))

  if (bullets.length === lines.length) {
    const items = lines
      .map(l => `  <li>${escapeHtml(l.replace(/^-\s*/, ''))}</li>`)
      .join('\n')
    return `<ul style="margin: 0 0 10px; padding-left: 20px;">\n${items}\n</ul>`
  }

  // Single newlines inside a paragraph are intentional line breaks
  return `<p style="margin: 0 0 10px;">${lines.map(escapeHtml).join('<br />')}</p>`
}

/**
 * Derive a readable group name from a set code, for the {SET} token.
 *
 * Promo prefixes get expanded because "SVP — PICK YOUR CARD" means nothing to a
 * buyer, whereas the full era name does. Anything unrecognised passes through
 * unchanged rather than being mangled by a guess.
 */
const SET_DISPLAY_NAMES: Record<string, string> = {
  SVP:  'Scarlet & Violet Black Star Promos',
  MEP:  'Mega Evolution Black Star Promos',
  SWSH: 'Sword & Shield Black Star Promos',
  SM:   'Sun & Moon Black Star Promos',
  XY:   'XY Black Star Promos',
  BW:   'Black & White Black Star Promos',
}

export function setDisplayName(setCode: string): string {
  if (!setCode) return 'Pokémon Cards'
  return SET_DISPLAY_NAMES[setCode.toUpperCase()] ?? `${setCode} Pokémon Cards`
}
