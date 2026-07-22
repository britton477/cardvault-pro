// =============================================================================
// CardVault Pro — eBay API Client (server-side only)
//
// SANDBOX vs PRODUCTION:
//   Set EBAY_ENV=sandbox  → all traffic goes to eBay sandbox
//   Set EBAY_ENV=production → live eBay (only when user confirms go-live)
//
// Security rules:
//   - This file MUST NEVER be imported from client-side code
//   - Credentials are AES-256-GCM encrypted at rest, decrypted only here
//   - Access tokens auto-refresh transparently via getValidAccessToken()
// =============================================================================

import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'

// ── Environment config ────────────────────────────────────────────────────────

const IS_SANDBOX = (process.env['EBAY_ENV'] ?? 'sandbox') !== 'production'

const URLS = {
  trading:    IS_SANDBOX
    ? 'https://api.sandbox.ebay.com/ws/api.dll'
    : 'https://api.ebay.com/ws/api.dll',
  browse:     IS_SANDBOX
    ? 'https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search'
    : 'https://api.ebay.com/buy/browse/v1/item_summary/search',
  oauthBase:  IS_SANDBOX
    ? 'https://auth.sandbox.ebay.com'
    : 'https://auth.ebay.com',
  tokenUrl:   IS_SANDBOX
    ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
    : 'https://api.ebay.com/identity/v1/oauth2/token',
}

export const EBAY_IS_SANDBOX = IS_SANDBOX

const SITE_ID = 3 // eBay UK

// ── Encryption helpers ────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm'
const ENC_KEY   = Buffer.from(process.env['EBAY_ENCRYPTION_KEY']!, 'hex') // 32 bytes

export function encrypt(plaintext: string): string {
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, ENC_KEY, iv)
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join('.')
}

export function decrypt(ciphertext: string): string {
  const [ivHex, tagHex, encHex] = ciphertext.split('.')
  if (!ivHex || !tagHex || !encHex) throw new Error('Invalid ciphertext format')
  const decipher = crypto.createDecipheriv(ALGORITHM, ENC_KEY, Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8')
}

// ── Credential types ──────────────────────────────────────────────────────────

export interface EbayCredentials {
  appId:          string
  secret:         string
  ruName:         string
  accessToken:    string | null
  refreshToken:   string | null
  tokenExpiresAt: Date | null
}

// ── Credential retrieval ──────────────────────────────────────────────────────

export async function getCredentials(orgId: string): Promise<EbayCredentials> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('ebay_credentials')
    .select('*')
    .eq('org_id', orgId)
    .single()

  if (error || !data) {
    throw new Error('eBay credentials not configured for this organisation')
  }

  return {
    appId:          data['app_id_enc']      ? decrypt(data['app_id_enc']  as string) : '',
    secret:         data['secret_enc']      ? decrypt(data['secret_enc']  as string) : '',
    ruName:         data['ru_name_enc']     ? decrypt(data['ru_name_enc'] as string) : '',
    accessToken:    data['access_token_enc']  ? decrypt(data['access_token_enc']  as string) : null,
    refreshToken:   data['refresh_token_enc'] ? decrypt(data['refresh_token_enc'] as string) : null,
    tokenExpiresAt: data['token_expires_at']
      ? new Date(data['token_expires_at'] as string)
      : null,
  }
}

export async function saveCredentials(
  orgId: string,
  creds: Pick<EbayCredentials, 'appId' | 'secret' | 'ruName'>,
): Promise<void> {
  const db = createAdminClient()
  const { error } = await db.from('ebay_credentials').upsert({
    org_id:      orgId,
    app_id_enc:  encrypt(creds.appId),
    secret_enc:  encrypt(creds.secret),
    ru_name_enc: encrypt(creds.ruName),
    updated_at:  new Date().toISOString(),
  })
  if (error) throw new Error(`Failed to save eBay credentials: ${error.message}`)
}

export async function saveTokens(
  orgId: string,
  accessToken: string,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<void> {
  const db = createAdminClient()
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000)
  const { error } = await db.from('ebay_credentials').update({
    access_token_enc:  encrypt(accessToken),
    refresh_token_enc: encrypt(refreshToken),
    token_expires_at:  expiresAt.toISOString(),
    updated_at:        new Date().toISOString(),
  }).eq('org_id', orgId)
  if (error) throw new Error(`Failed to save eBay tokens: ${error.message}`)
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

const OAUTH_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
].join(' ')

/**
 * Build the eBay consent URL to redirect the user to.
 * The RuName must match the redirect URI registered in the eBay developer portal.
 */
export function buildConsentUrl(appId: string, ruName: string): string {
  const params = new URLSearchParams({
    client_id:     appId,
    redirect_uri:  ruName,
    response_type: 'code',
    scope:         OAUTH_SCOPES,
    prompt:        'login',
  })
  return `${URLS.oauthBase}/oauth2/authorize?${params}`
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(
  code: string,
  appId: string,
  secret: string,
  ruName: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const credentials = Buffer.from(`${appId}:${secret}`).toString('base64')
  const res = await fetch(URLS.tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: ruName,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json() as {
    access_token:  string
    refresh_token: string
    expires_in:    number
  }

  return {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresIn:    data.expires_in,
  }
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string,
  appId: string,
  secret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const credentials = Buffer.from(`${appId}:${secret}`).toString('base64')
  const res = await fetch(URLS.tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         OAUTH_SCOPES,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

/**
 * Get a valid access token for the org, auto-refreshing if it expires within 5 minutes.
 * This is the single entry point all Trading API callers should use.
 */
export async function getValidAccessToken(orgId: string): Promise<string> {
  const creds = await getCredentials(orgId)

  if (!creds.accessToken) {
    throw new Error('eBay account not connected. Please connect via Settings → eBay.')
  }

  // Refresh if token expires within 5 minutes
  const fiveMinutes = 5 * 60 * 1000
  const needsRefresh = !creds.tokenExpiresAt
    || creds.tokenExpiresAt.getTime() - Date.now() < fiveMinutes

  if (needsRefresh) {
    if (!creds.refreshToken) {
      throw new Error('eBay refresh token missing. Please reconnect via Settings → eBay.')
    }
    const { accessToken, expiresIn } = await refreshAccessToken(
      creds.refreshToken, creds.appId, creds.secret,
    )
    // Persist the new token (refresh token stays the same until user reconnects)
    await saveTokens(orgId, accessToken, creds.refreshToken, expiresIn)
    return accessToken
  }

  return creds.accessToken
}

// ── Trading API (XML) ─────────────────────────────────────────────────────────

function buildXmlHeader(callName: string, authToken: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken}</eBayAuthToken>
  </RequesterCredentials>`
}

function extractXmlField(xml: string, tag: string): string {
  // Match tag with or without attributes: <Tag> or <Tag attr="val">
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]+)<\\/${tag}>`))
  return match?.[1]?.trim() ?? ''
}

interface EbayError {
  code:     string
  short:    string
  long:     string
  severity: string
}

function extractErrors(xml: string): EbayError[] {
  const blocks = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)]
  return blocks.map(m => ({
    code:     extractXmlField(m[1] ?? '', 'ErrorCode'),
    short:    extractXmlField(m[1] ?? '', 'ShortMessage'),
    long:     extractXmlField(m[1] ?? '', 'LongMessage'),
    severity: extractXmlField(m[1] ?? '', 'SeverityCode'),
  }))
}

async function callTradingApi(
  callName: string,
  body: string,
  authToken: string,
  appId: string,
): Promise<string> {
  const res = await fetch(URLS.trading, {
    method: 'POST',
    headers: {
      'Content-Type':                     'text/xml',
      'X-EBAY-API-CALL-NAME':             callName,
      'X-EBAY-API-SITEID':                String(SITE_ID),
      'X-EBAY-API-APP-NAME':              appId,
      'X-EBAY-API-DEV-NAME':              'CardVaultPro',
      'X-EBAY-API-CERT-NAME':             '',
      'X-EBAY-API-COMPATIBILITY-LEVEL':   '1155',
      'X-EBAY-API-IAF-TOKEN':             authToken,
    },
    body,
  })

  const text = await res.text()
  const ack  = extractXmlField(text, 'Ack')

  if (ack !== 'Success' && ack !== 'Warning') {
    const errors = extractErrors(text)
    const e = errors[0]
    const msg = e
      ? `${e.short}${e.long ? ' — ' + e.long : ''}${e.code ? ' [' + e.code + ']' : ''}`
      : `HTTP ${res.status}`
    throw new Error(msg)
  }

  return text
}

// ── List a card on eBay ───────────────────────────────────────────────────────

export interface ListItemOptions {
  orgId:               string
  /**
   * eBay SKU — always the card UUID.
   *
   * This is the durable link between an eBay order and the card it came from.
   * Order sync matches on SKU first because ebay_listing_id gets cleared when a
   * listing ends or a card is marked Sold, at which point an incoming order has
   * nothing left to match against and lands in the needs-review bucket.
   */
  sku:                 string
  title:               string
  description:         string
  condition:           string
  isGraded?:           boolean       // true = professionally graded card
  grader?:             string | null // e.g. 'PSA', 'BGS', 'CGC'
  grade?:              string | null // e.g. '10', '9.5' — used as ConditionDescriptor 27502
  price:               number
  quantity:            number
  photoUrls:           string[]
  location:            string
  fulfillmentPolicyId: string
  paymentPolicyId:     string
  returnPolicyId:      string
  // Item specifics — passed directly to eBay ItemSpecifics for better search indexing
  cardName?:           string | null // Actual card name (e.g. "Charizard")
  setCode?:            string | null // Set code (e.g. "SVI", "OBF")
  cardNumber?:         string | null // Card number (e.g. "006/198")
  language?:           string | null // Language code (e.g. "EN", "JP")
}

// ── eBay Trading API condition vocabulary for category 183454 (Pokémon TCG) ────
//
// ConditionID:
//   4000 = Ungraded card (all raw conditions — NM/LP/MP/HP/Sealed)
//   2750 = Professionally Graded
//
// For UNGRADED cards, the specific condition is communicated via ConditionDescriptor:
//   Name=40001, Value=numeric card-condition ID:
//     400010 = Near Mint (NM)
//     400015 = Lightly Played / Excellent (LP)
//     400016 = Moderately Played / Very Good (MP)
//     400017 = Heavily Played / Poor (HP)
//
// For GRADED cards, two descriptors are sent:
//   Name=27501 (Professional Grader):
//     275010=PSA  275013=BGS  275015=CGC  2750119=ACE  2750123=Arkezon
//   Name=27502 (Grade):
//     275020=10  275021=9.5  275022=9  275023=8.5  275024=8  275025=7.5
//     275026=7   275027=6.5  275028=6  275029=5.5  2750210=5  ...  2750218=1
//
// Source: verified against old working production app (ebay-proxy.js)

const UNGRADED_COND_ID: Record<string, string> = {
  NM:     '400010',
  LP:     '400015',
  MP:     '400016',
  HP:     '400017',
  Sealed: '400010',  // Sealed treated as NM-equivalent for descriptor
}

const GRADER_ID: Record<string, string> = {
  PSA:     '275010',
  BGS:     '275013',
  CGC:     '275015',
  ACE:     '2750119',
  Arkezon: '2750123',
}

const GRADE_ID: Record<string, string> = {
  '10':  '275020', '9.5': '275021', '9':   '275022', '8.5': '275023',
  '8':   '275024', '7.5': '275025', '7':   '275026', '6.5': '275027',
  '6':   '275028', '5.5': '275029', '5':   '2750210', '4.5': '2750211',
  '4':   '2750212', '3.5': '2750213', '3':  '2750214', '2.5': '2750215',
  '2':   '2750216', '1.5': '2750217', '1':  '2750218',
}

export async function listItem(opts: ListItemOptions): Promise<string> {
  const creds    = await getCredentials(opts.orgId)
  const token    = await getValidAccessToken(opts.orgId)

  const isGraded = opts.isGraded && !!opts.grader
  const condId   = isGraded ? '2750' : '4000'

  const pictures = opts.photoUrls
    .map(u => `<PictureURL>${u}</PictureURL>`)
    .join('\n')

  // ConditionDescriptors: always required in category 183454.
  // Ungraded: Name=40001 with the specific card-condition numeric ID.
  // Graded:   Name=27501 (grader numeric ID) + Name=27502 (grade numeric ID).
  let conditionDescriptorsXml: string
  if (isGraded && opts.grader) {
    const graderId = GRADER_ID[opts.grader] ?? GRADER_ID['PSA']!
    const gradeId  = opts.grade ? (GRADE_ID[opts.grade] ?? '') : ''
    conditionDescriptorsXml = `<ConditionDescriptors>
      <ConditionDescriptor><Name>27501</Name><Value>${graderId}</Value></ConditionDescriptor>${gradeId ? `
      <ConditionDescriptor><Name>27502</Name><Value>${gradeId}</Value></ConditionDescriptor>` : ''}
    </ConditionDescriptors>`
  } else {
    const cardCondId = UNGRADED_COND_ID[opts.condition] ?? UNGRADED_COND_ID['NM']!
    conditionDescriptorsXml = `<ConditionDescriptors>
      <ConditionDescriptor><Name>40001</Name><Value>${cardCondId}</Value></ConditionDescriptor>
    </ConditionDescriptors>`
  }

  const xml = `${buildXmlHeader('AddFixedPriceItem', token)}
  <Item>
    <SKU>${escapeXml(opts.sku)}</SKU>
    <Title>${escapeXml(opts.title)}</Title>
    <Description><![CDATA[${opts.description}]]></Description>
    <PrimaryCategory><CategoryID>183454</CategoryID></PrimaryCategory>
    <StartPrice>${opts.price.toFixed(2)}</StartPrice>
    <ConditionID>${condId}</ConditionID>
    ${conditionDescriptorsXml}
    <ItemSpecifics>
      <NameValueList><Name>Game</Name><Value>Pokémon</Value></NameValueList>
      <NameValueList><Name>Graded</Name><Value>${isGraded ? 'Yes' : 'No'}</Value></NameValueList>${opts.cardName ? `
      <NameValueList><Name>Card Name</Name><Value>${escapeXml(opts.cardName)}</Value></NameValueList>` : ''}${opts.setCode ? `
      <NameValueList><Name>Set</Name><Value>${escapeXml(opts.setCode)}</Value></NameValueList>` : ''}${opts.cardNumber ? `
      <NameValueList><Name>Card Number</Name><Value>${escapeXml(opts.cardNumber)}</Value></NameValueList>` : ''}${opts.language ? `
      <NameValueList><Name>Language</Name><Value>${escapeXml(opts.language === 'EN' ? 'English' : opts.language === 'JP' ? 'Japanese' : opts.language === 'DE' ? 'German' : opts.language === 'FR' ? 'French' : opts.language === 'ES' ? 'Spanish' : opts.language === 'IT' ? 'Italian' : opts.language === 'PT' ? 'Portuguese' : opts.language === 'KO' ? 'Korean' : opts.language)}</Value></NameValueList>` : ''}
      <NameValueList><Name>Type</Name><Value>Individual Cards</Value></NameValueList>
    </ItemSpecifics>
    <Country>GB</Country>
    <Currency>GBP</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Location>${escapeXml(opts.location)}</Location>
    <PictureDetails>${pictures}</PictureDetails>
    <Quantity>${opts.quantity}</Quantity>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${opts.fulfillmentPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${opts.paymentPolicyId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${opts.returnPolicyId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
  </Item>
</AddFixedPriceItemRequest>`

  const response = await callTradingApi('AddFixedPriceItem', xml, token, creds.appId)
  return extractXmlField(response, 'ItemID')
}

// ── Revise a listing price ────────────────────────────────────────────────────

export async function reviseItem(
  orgId: string,
  listingId: string,
  newPrice: number,
): Promise<void> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const xml = `${buildXmlHeader('ReviseItem', token)}
  <Item>
    <ItemID>${listingId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </Item>
</ReviseItemRequest>`

  await callTradingApi('ReviseItem', xml, token, creds.appId)
}

/**
 * Revise the available quantity on a single-card fixed-price listing.
 *
 * Setting quantity to 0 ends the listing on eBay's side, which is the correct
 * outcome when stock runs out.
 */
export async function reviseItemQuantity(
  orgId: string,
  listingId: string,
  quantity: number,
): Promise<void> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const xml = `${buildXmlHeader('ReviseFixedPriceItem', token)}
  <Item>
    <ItemID>${listingId}</ItemID>
    <Quantity>${Math.max(0, Math.floor(quantity))}</Quantity>
  </Item>
</ReviseFixedPriceItemRequest>`

  await callTradingApi('ReviseFixedPriceItem', xml, token, creds.appId)
}

// ── End a listing ─────────────────────────────────────────────────────────────

export async function endItem(
  orgId: string,
  listingId: string,
  reason: 'NotAvailable' | 'LostOrBroken' | 'OtherListingError' = 'NotAvailable',
): Promise<void> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const xml = `${buildXmlHeader('EndItem', token)}
  <ItemID>${listingId}</ItemID>
  <EndingReason>${reason}</EndingReason>
</EndItemRequest>`

  await callTradingApi('EndItem', xml, token, creds.appId)
}

// ── Multi-variation "Complete Your Set" listings ──────────────────────────────
//
// Overview:
//   eBay allows up to 250 variations within a single FixedPriceItem listing.
//   Each variation is one card identified by its UUID (card.id) as the eBay SKU.
//   The variation specifier name is discovered per category via
//   getVariationSpecificName() — eBay reserves its own item specifics and
//   rejects them here, so it cannot be hardcoded.
//   When multiple cards share the same name, the card number is appended:
//   e.g. "Charizard" (unique) vs "Charizard #006/198" (disambiguated).
//
// Functions:
//   createVariationListing   — AddFixedPriceItem with <Variations> block
//   updateVariationQuantities — ReviseFixedPriceItem targeting variations by SKU
//   addVariationsToListing   — Adds new cards to an existing set listing
//   syncVariationQuantities  — GetItem to detect eBay qty drift vs DB qty

/**
 * eBay's hard ceiling on variations within a single fixed-price listing.
 * Exceeding it is rejected at the API layer, so callers must check BEFORE
 * mutating local state.
 */
export const EBAY_MAX_VARIATIONS = 250

/**
 * Build display names for a set of cards, guaranteed unique.
 *
 * eBay rejects a listing whose variation values repeat (21916692), which is
 * fatal rather than cosmetic — one collision kills the whole listing. Two rows
 * of the same card in the same condition should really have been merged into
 * one row with a higher quantity, but a listing must not break because they
 * weren't.
 *
 * Disambiguation escalates only as far as needed, so the common case stays
 * clean for the buyer:
 *
 *   Charizard                     — name alone is unique
 *   Charizard #006/198            — another Charizard exists
 *   Charizard #006/198 (Holo)     — same number, different finish
 *   Charizard #006/198 (Holo) 2   — genuinely identical rows
 */
export function buildUniqueDisplayNames(
  cards: Array<{
    id:           string
    card_name:    string
    card_number?: string | null
    foil_type?:   string | null
    condition?:   string | null
  }>,
): Map<string, string> {
  // 1. Card number is only added when the name alone is ambiguous
  const nameCount = new Map<string, number>()
  for (const c of cards) nameCount.set(c.card_name, (nameCount.get(c.card_name) ?? 0) + 1)

  const baseName = (c: typeof cards[number]) =>
    (nameCount.get(c.card_name) ?? 0) > 1 && c.card_number
      ? `${c.card_name} #${c.card_number}`
      : c.card_name

  // 2. Group by base name, then decide whether finish actually distinguishes.
  //
  // Tagging only one of three identical Holos as "(Holo)" would imply the other
  // two are something else. Finish is added to ALL cards in a group, or none —
  // and only when the group genuinely contains more than one finish.
  const groups = new Map<string, typeof cards>()
  for (const c of cards) {
    const key = baseName(c)
    const g   = groups.get(key)
    if (g) g.push(c)
    else   groups.set(key, [c])
  }

  const result = new Map<string, string>()
  const used   = new Set<string>()

  for (const [base, group] of groups) {
    const finishes    = new Set(group.map(c => c.foil_type ?? 'Normal'))
    const useFinish   = group.length > 1 && finishes.size > 1

    for (const c of group) {
      let name = useFinish
        ? `${base} (${c.foil_type ?? 'Normal'})`
        : base

      // Last resort: a counter. Reached only when rows are genuinely identical
      // in every respect, which means they should have been one row with a
      // higher quantity all along.
      if (used.has(name)) {
        let n = 2
        while (used.has(`${name} ${n}`)) n++
        name = `${name} ${n}`
      }

      used.add(name)
      result.set(c.id, name)
    }
  }

  return result
}

export interface VariationInput {
  sku:         string   // card.id — stored as eBay SKU for all future updates
  displayName: string   // value shown to buyer (e.g. "Charizard" or "Charizard #006/198")
  price:       number
  quantity:    number
  /**
   * Photo of this specific card, shown when the buyer picks it from the
   * dropdown. Optional — variations without one fall back to the gallery.
   */
  photoUrl?:   string
}

// ── Variation specific name discovery ─────────────────────────────────────────
//
// eBay forbids using a category's own item specifics as a variation specific.
// For Pokémon singles (183454), "Card Name" is a recognised aspect, so passing
// it as the variation specific is rejected:
//
//   21920061 — Card Name is not allowed as a variation specific
//
// The set of reserved names is category-specific and changes over time, so it
// cannot be hardcoded. GetCategorySpecifics reports, per aspect, whether it may
// be used for variations — we ask eBay rather than guessing.
//
// Cached per category for the process lifetime: the answer changes on eBay's
// schedule, not ours, and this would otherwise cost an API call per listing.

const variationSpecificCache = new Map<string, string>()

/**
 * A name that is safe precisely because it is NOT a Pokémon TCG category
 * aspect, so it cannot collide with eBay's reserved list. Used when the
 * category reports no variation-enabled aspects, which is the common case for
 * trading cards.
 *
 * Buyers see this as the dropdown label on the listing, so it has to read
 * naturally: "Select: Charizard #006".
 */
const FALLBACK_VARIATION_SPECIFIC = 'Select'

/**
 * Discover a variation specific name eBay will accept for a category.
 *
 * Prefers an aspect eBay explicitly marks as variation-enabled. Falls back to
 * a custom name that is not a category aspect, which eBay permits.
 */
export async function getVariationSpecificName(
  orgId: string,
  categoryId = '183454',
): Promise<string> {
  const cached = variationSpecificCache.get(categoryId)
  if (cached) return cached

  try {
    const creds = await getCredentials(orgId)
    const token = await getValidAccessToken(orgId)

    const xml = `${buildXmlHeader('GetCategorySpecifics', token)}
  <CategoryID>${categoryId}</CategoryID>
</GetCategorySpecificsRequest>`

    const response = await callTradingApi('GetCategorySpecifics', xml, token, creds.appId)

    // Each recommendation carries validation rules; VariationSpecifics tells us
    // whether that name may be used to distinguish variations.
    const blocks = [...response.matchAll(/<NameRecommendation>([\s\S]*?)<\/NameRecommendation>/g)]
    for (const m of blocks) {
      const block = m[1] ?? ''
      const name  = extractXmlField(block, 'Name')
      const varOk = extractXmlField(block, 'VariationSpecifics')
      if (name && varOk === 'Enabled') {
        variationSpecificCache.set(categoryId, name)
        return name
      }
    }
  } catch (err) {
    // Discovery is best-effort. A category lookup failure must not block
    // listing when we have a known-safe fallback.
    console.warn(`[getVariationSpecificName] lookup failed for ${categoryId}:`, err)
  }

  variationSpecificCache.set(categoryId, FALLBACK_VARIATION_SPECIFIC)
  return FALLBACK_VARIATION_SPECIFIC
}

export interface CreateVariationListingOptions {
  orgId:               string
  title:               string
  description:         string
  /** Condition applied at item level — all cards in a set listing share one condition */
  condition:           string
  setCode?:            string
  /** Max 250 variations */
  variations:          VariationInput[]
  photoUrls:           string[]
  location:            string
  fulfillmentPolicyId: string
  paymentPolicyId:     string
  returnPolicyId:      string
}

export interface CreateVariationListingResult {
  ebayListingId: string
  itemUrl:       string
}

/**
 * Create a multi-variation "Complete Your Set" listing on eBay.
 *
 * Each variation is one card, identified by its UUID (card.id) as the eBay SKU.
 * The SKU is the stable link between CardVault Pro and eBay — use it for all
 * future ReviseFixedPriceItem calls to update quantity or price without relying
 * on string matching.
 *
 * Condition is applied at the item level (all cards in a set listing share one
 * condition). This is standard practice for "Complete Your Set" listings.
 *
 * Returns { ebayListingId, itemUrl } on success.
 */
export async function createVariationListing(
  opts: CreateVariationListingOptions,
): Promise<CreateVariationListingResult> {
  const creds = await getCredentials(opts.orgId)
  const token = await getValidAccessToken(opts.orgId)

  if (opts.variations.length === 0)
    throw new Error('createVariationListing: at least one variation required')
  if (opts.variations.length > EBAY_MAX_VARIATIONS)
    throw new Error(`createVariationListing: eBay limits variation listings to ${EBAY_MAX_VARIATIONS} variations`)

  // Variation listings are always ungraded raw cards — graded slabs are listed as singles
  const condId     = '4000'
  const cardCondId = UNGRADED_COND_ID[opts.condition] ?? UNGRADED_COND_ID['NM']!

  // Ask eBay what it will accept rather than assuming. "Card Name" is rejected
  // for this category because it is a recognised item specific.
  const specificName = await getVariationSpecificName(opts.orgId)

  // VariationSpecificsSet: every value the buyer can choose between
  const allNamesXml = opts.variations
    .map(v => `      <Value>${escapeXml(v.displayName)}</Value>`)
    .join('\n')

  // Individual Variation blocks — one per card
  const variationsXml = opts.variations.map(v => `    <Variation>
      <SKU>${escapeXml(v.sku)}</SKU>
      <StartPrice>${v.price.toFixed(2)}</StartPrice>
      <Quantity>${v.quantity}</Quantity>
      <VariationSpecifics>
        <NameValueList>
          <Name>${escapeXml(specificName)}</Name>
          <Value>${escapeXml(v.displayName)}</Value>
        </NameValueList>
      </VariationSpecifics>
    </Variation>`).join('\n')

  // ── Item-level gallery ────────────────────────────────────────────────────
  //
  // eBay requires at least one picture on every listing (21919136). For a set
  // listing there is no single "the item", so the gallery is built from the
  // variation photos themselves — the first few cards stand in for the listing.
  //
  // Capped at 12: eBay allows 24, but a wall of near-identical card scans adds
  // nothing for the buyer, who picks from the dropdown anyway.
  // Item-level gallery.
  //
  // Deliberately minimal. eBay shows the item pictures AND the per-variation
  // pictures in the same photo strip, so any card photo listed here appears
  // twice — once as a gallery image, once as its variation's image. Filling the
  // gallery with card photos produced a strip of visible duplicates.
  //
  // With a cover supplied the gallery is just that: one clean thumbnail, with
  // every card shown through its own variation. Without one, eBay still demands
  // at least one item picture, so a single card photo stands in — one repeat
  // rather than twelve.
  const cardPhotos = opts.variations
    .map(v => v.photoUrl)
    .filter((u): u is string => !!u)

  const galleryUrls = opts.photoUrls.length > 0
    ? opts.photoUrls
    : cardPhotos.slice(0, 1)

  if (galleryUrls.length === 0) {
    throw new Error(
      'eBay requires at least one photo. None of the selected cards have an image — ' +
      'add a photo to at least one card before creating a set listing.',
    )
  }

  const pictures = galleryUrls
    .map(u => `<PictureURL>${escapeXml(u)}</PictureURL>`)
    .join('\n      ')

  // ── Per-variation pictures ────────────────────────────────────────────────
  //
  // Shows the buyer the actual card when they select it, rather than a generic
  // gallery shot. This is the difference between a listing that reads as a real
  // inventory of distinct cards and one that looks like a stock photo.
  //
  // Keyed on the same specific name used for the variations themselves — eBay
  // rejects a mismatch.
  const variationsWithPhotos = opts.variations.filter(v => v.photoUrl)

  const variationPicturesXml = variationsWithPhotos.length > 0
    ? `      <Pictures>
        <VariationSpecificName>${escapeXml(specificName)}</VariationSpecificName>
${variationsWithPhotos.map(v => `        <VariationSpecificPictureSet>
          <VariationSpecificValue>${escapeXml(v.displayName)}</VariationSpecificValue>
          <PictureURL>${escapeXml(v.photoUrl!)}</PictureURL>
        </VariationSpecificPictureSet>`).join('\n')}
      </Pictures>
`
    : ''

  const xml = `${buildXmlHeader('AddFixedPriceItem', token)}
  <Item>
    <Title>${escapeXml(opts.title)}</Title>
    <Description><![CDATA[${opts.description}]]></Description>
    <PrimaryCategory><CategoryID>183454</CategoryID></PrimaryCategory>
    <ConditionID>${condId}</ConditionID>
    <ConditionDescriptors>
      <ConditionDescriptor><Name>40001</Name><Value>${cardCondId}</Value></ConditionDescriptor>
    </ConditionDescriptors>
    <ItemSpecifics>
      <NameValueList><Name>Game</Name><Value>Pokémon</Value></NameValueList>
      <NameValueList><Name>Graded</Name><Value>No</Value></NameValueList>${opts.setCode ? `
      <NameValueList><Name>Set</Name><Value>${escapeXml(opts.setCode)}</Value></NameValueList>` : ''}
      <NameValueList><Name>Type</Name><Value>Individual Cards</Value></NameValueList>
    </ItemSpecifics>
    <Variations>
${variationPicturesXml}      <VariationSpecificsSet>
        <NameValueList>
          <Name>${escapeXml(specificName)}</Name>
${allNamesXml}
        </NameValueList>
      </VariationSpecificsSet>
${variationsXml}
    </Variations>
    <Country>GB</Country>
    <Currency>GBP</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>GTC</ListingDuration>
    <ListingType>FixedPriceItem</ListingType>
    <Location>${escapeXml(opts.location)}</Location>
    <PictureDetails>
      ${pictures}
    </PictureDetails>
    <SellerProfiles>
      <SellerShippingProfile>
        <ShippingProfileID>${opts.fulfillmentPolicyId}</ShippingProfileID>
      </SellerShippingProfile>
      <SellerPaymentProfile>
        <PaymentProfileID>${opts.paymentPolicyId}</PaymentProfileID>
      </SellerPaymentProfile>
      <SellerReturnProfile>
        <ReturnProfileID>${opts.returnPolicyId}</ReturnProfileID>
      </SellerReturnProfile>
    </SellerProfiles>
  </Item>
</AddFixedPriceItemRequest>`

  const response      = await callTradingApi('AddFixedPriceItem', xml, token, creds.appId)
  const ebayListingId = extractXmlField(response, 'ItemID')
  if (!ebayListingId) throw new Error('createVariationListing: eBay did not return an ItemID')

  const itemUrl = IS_SANDBOX
    ? `https://www.sandbox.ebay.co.uk/itm/${ebayListingId}`
    : `https://www.ebay.co.uk/itm/${ebayListingId}`

  return { ebayListingId, itemUrl }
}

export interface VariationQtyUpdate {
  sku:      string   // card.id
  quantity: number
  price?:   number   // optional — omit to leave existing price unchanged
}

/**
 * Update quantities (and optionally prices) for one or more variations in a
 * multi-variation listing. Batches all changes into a single ReviseFixedPriceItem call.
 *
 * eBay matches variations by SKU (which we set to card.id at creation time),
 * so this is robust against title changes and card name renames.
 */
export async function updateVariationQuantities(
  orgId:         string,
  ebayListingId: string,
  updates:       VariationQtyUpdate[],
): Promise<void> {
  if (updates.length === 0) return

  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const variationsXml = updates.map(u => `    <Variation>
      <SKU>${escapeXml(u.sku)}</SKU>
      <Quantity>${u.quantity}</Quantity>${u.price != null ? `
      <StartPrice>${u.price.toFixed(2)}</StartPrice>` : ''}
    </Variation>`).join('\n')

  const xml = `${buildXmlHeader('ReviseFixedPriceItem', token)}
  <Item>
    <ItemID>${ebayListingId}</ItemID>
    <Variations>
${variationsXml}
    </Variations>
  </Item>
</ReviseFixedPriceItemRequest>`

  await callTradingApi('ReviseFixedPriceItem', xml, token, creds.appId)
}

/**
 * Add new card variations to an existing multi-variation listing.
 *
 * eBay requires the full VariationSpecificsSet to be re-sent with all values
 * (existing + new) whenever you add variations. The caller supplies the
 * existing display names so we can build the merged set correctly.
 *
 * Only the NEW variations are sent as <Variation> entries — existing ones
 * are left untouched by eBay when not included in the revise call.
 */
export async function addVariationsToListing(
  orgId:          string,
  ebayListingId:  string,
  newVariations:  VariationInput[],
  existingNames:  string[],  // display names already in the eBay listing
): Promise<void> {
  if (newVariations.length === 0) return

  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  // Must be the SAME specific name the listing was created with — eBay rejects
  // a revision whose variation specifics don't match the existing ones. The
  // per-category cache makes this consistent within a process, and a cold cache
  // re-derives the same answer from eBay.
  const specificName = await getVariationSpecificName(orgId)

  // Merge existing + new display names — eBay requires the full set on every revise
  const mergedNamesXml = [...existingNames, ...newVariations.map(v => v.displayName)]
    .map(n => `      <Value>${escapeXml(n)}</Value>`)
    .join('\n')

  const newVariationsXml = newVariations.map(v => `    <Variation>
      <SKU>${escapeXml(v.sku)}</SKU>
      <StartPrice>${v.price.toFixed(2)}</StartPrice>
      <Quantity>${v.quantity}</Quantity>
      <VariationSpecifics>
        <NameValueList>
          <Name>${escapeXml(specificName)}</Name>
          <Value>${escapeXml(v.displayName)}</Value>
        </NameValueList>
      </VariationSpecifics>
    </Variation>`).join('\n')

  // Carry each new card's photo across too, otherwise cards added later would
  // show the gallery image while the originals show their own card.
  const newWithPhotos = newVariations.filter(v => v.photoUrl)
  const newPicturesXml = newWithPhotos.length > 0
    ? `      <Pictures>
        <VariationSpecificName>${escapeXml(specificName)}</VariationSpecificName>
${newWithPhotos.map(v => `        <VariationSpecificPictureSet>
          <VariationSpecificValue>${escapeXml(v.displayName)}</VariationSpecificValue>
          <PictureURL>${escapeXml(v.photoUrl!)}</PictureURL>
        </VariationSpecificPictureSet>`).join('\n')}
      </Pictures>
`
    : ''

  const xml = `${buildXmlHeader('ReviseFixedPriceItem', token)}
  <Item>
    <ItemID>${ebayListingId}</ItemID>
    <Variations>
${newPicturesXml}      <VariationSpecificsSet>
        <NameValueList>
          <Name>${escapeXml(specificName)}</Name>
${mergedNamesXml}
        </NameValueList>
      </VariationSpecificsSet>
${newVariationsXml}
    </Variations>
  </Item>
</ReviseFixedPriceItemRequest>`

  await callTradingApi('ReviseFixedPriceItem', xml, token, creds.appId)
}

export interface VariationQtyDiscrepancy {
  sku:         string   // card.id
  displayName: string
  ebayQty:     number   // what eBay currently shows
  dbQty:       number   // what our DB thinks it should be
  /** ebayQty - dbQty. Negative means eBay sold some and DB wasn't updated. */
  discrepancy: number
}

/**
 * Compare eBay's current variation quantities against the DB quantities.
 * Returns only variations where quantities differ, so callers can decide
 * whether to push the DB state to eBay or pull the eBay state into the DB.
 *
 * Uses GetItem (Trading API) to retrieve the live eBay state — each call
 * costs one Trading API quota unit so call sparingly (e.g. on-demand sync,
 * not on every page load).
 */
export async function syncVariationQuantities(
  orgId:         string,
  ebayListingId: string,
  dbVariations:  Array<{ sku: string; displayName: string; qty: number }>,
): Promise<VariationQtyDiscrepancy[]> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const xml = `${buildXmlHeader('GetItem', token)}
  <ItemID>${ebayListingId}</ItemID>
  <DetailLevel>ReturnAll</DetailLevel>
  <IncludeItemSpecifics>false</IncludeItemSpecifics>
</GetItemRequest>`

  const response = await callTradingApi('GetItem', xml, token, creds.appId)

  // Parse each <Variation> block for SKU + Quantity
  const variationBlocks = [...response.matchAll(/<Variation>([\s\S]*?)<\/Variation>/g)]
  const ebayQtyBySku    = new Map<string, number>()
  for (const m of variationBlocks) {
    const block = m[1] ?? ''
    const sku   = extractXmlField(block, 'SKU')
    const qty   = parseInt(extractXmlField(block, 'Quantity') || '0', 10)
    if (sku) ebayQtyBySku.set(sku, qty)
  }

  return dbVariations
    .map(v => ({
      sku:         v.sku,
      displayName: v.displayName,
      ebayQty:     ebayQtyBySku.get(v.sku) ?? 0,
      dbQty:       v.qty,
      discrepancy: (ebayQtyBySku.get(v.sku) ?? 0) - v.qty,
    }))
    .filter(d => d.discrepancy !== 0)
}

// ── Get active listings ───────────────────────────────────────────────────────

export interface EbayActiveListing {
  listingId:   string
  title:       string
  price:       number
  quantity:    number
  watchCount:  number
  viewCount:   number
  startTime:   string
  endTime:     string
  listingUrl:  string
}

export async function getActiveListings(orgId: string): Promise<EbayActiveListing[]> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const xml = `${buildXmlHeader('GetMyeBaySelling', token)}
  <ActiveList>
    <Include>true</Include>
    <IncludeWatchCount>true</IncludeWatchCount>
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`

  const response = await callTradingApi('GetMyeBaySelling', xml, token, creds.appId)

  const items = [...response.matchAll(/<Item>([\s\S]*?)<\/Item>/g)]
  return items.map(m => {
    const block      = m[1] ?? ''
    const listingId  = extractXmlField(block, 'ItemID')
    // CurrentPrice has a currencyID attribute: <CurrentPrice currencyID="GBP">5.99</CurrentPrice>
    // extractXmlField now handles attributes correctly
    const price      = parseFloat(extractXmlField(block, 'CurrentPrice') || '0')
    // StartTime/EndTime live inside <ListingDetails> — extractXmlField searches the whole block
    // so it finds them without needing to navigate the nesting explicitly
    const startTime  = extractXmlField(block, 'StartTime')
    const endTime    = extractXmlField(block, 'EndTime')
    const listingUrl = extractXmlField(block, 'ViewItemURL') ||
      (IS_SANDBOX
        ? `https://www.sandbox.ebay.co.uk/itm/${listingId}`
        : `https://www.ebay.co.uk/itm/${listingId}`)

    return {
      listingId,
      title:      extractXmlField(block, 'Title'),
      price,
      quantity:   parseInt(extractXmlField(block, 'Quantity') || '0', 10),
      watchCount: parseInt(extractXmlField(block, 'WatchCount') || '0', 10),
      viewCount:  parseInt(extractXmlField(block, 'HitCount')   || '0', 10),
      startTime,
      endTime,
      listingUrl,
    }
  // Filter: must have a valid ItemID. Price=0 is allowed (free listings / parse fallback)
  // but we log it so we can detect if the attribute fix regressed
  }).filter(l => {
    if (!l.listingId) return false
    if (l.price === 0) console.warn(`[getActiveListings] price=0 for listing ${l.listingId} — check XML`)
    return true
  })
}

// ── GetOrders — completed sales ───────────────────────────────────────────────
//
// One eBay ORDER can contain several TRANSACTIONS (a buyer purchasing three
// different cards in one checkout). CardVault records one sale per transaction,
// because each maps to a different card with its own cost basis.
//
// Order-level money (postage the buyer paid, and the order total) cannot be
// attributed to a single transaction, so we keep per-transaction item pricing
// and apportion nothing. Postage is recorded on the order for reference only.

export interface EbayOrderTransaction {
  orderId:         string
  transactionId:   string
  /** SKU we set at listing time — card.id for both singles and variations */
  sku:             string
  listingId:       string
  title:           string
  /** Variation name for multi-variation listings, e.g. "Charizard #006/198" */
  variationName:   string
  quantity:        number
  /** Per-unit price paid by the buyer, excluding postage */
  unitPrice:       number
  /** Total for this line: unitPrice × quantity */
  linePrice:       number
  buyerUserId:     string
  buyerName:       string
  /** Postage the BUYER paid on this line (not the seller's label cost) */
  shippingPaid:    number
  /** eBay's Final Value / Buyer Protection fee for this line where reported */
  feeAmount:       number
  saleDate:        string   // ISO
  orderStatus:     string   // Completed | Active | Cancelled | Inactive
  paidStatus:      string
  shippedStatus:   string
  trackingNumber:  string
}

/**
 * Fetch orders created within a date range.
 *
 * eBay caps GetOrders at a 30-day window per call, so longer ranges are split
 * into 30-day chunks automatically. Results are paginated at 100 per page.
 *
 * Only orders whose payment has cleared are useful as sales, but we return
 * everything and let the caller decide — cancelled orders matter for reversing
 * a previously synced sale.
 */
export async function getOrders(
  orgId: string,
  fromDate: Date,
  toDate: Date = new Date(),
): Promise<EbayOrderTransaction[]> {
  const creds = await getCredentials(orgId)
  const token = await getValidAccessToken(orgId)

  const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const all: EbayOrderTransaction[] = []

  // Split into ≤30-day windows — eBay rejects wider ranges outright
  let windowStart = new Date(fromDate)
  while (windowStart < toDate) {
    const windowEnd = new Date(Math.min(windowStart.getTime() + MAX_WINDOW_MS, toDate.getTime()))

    let pageNumber = 1
    let hasMore    = true

    while (hasMore && pageNumber <= 50) {   // hard stop — 5000 orders per window
      const xml = `${buildXmlHeader('GetOrders', token)}
  <CreateTimeFrom>${windowStart.toISOString()}</CreateTimeFrom>
  <CreateTimeTo>${windowEnd.toISOString()}</CreateTimeTo>
  <OrderRole>Seller</OrderRole>
  <OrderStatus>All</OrderStatus>
  <DetailLevel>ReturnAll</DetailLevel>
  <Pagination>
    <EntriesPerPage>100</EntriesPerPage>
    <PageNumber>${pageNumber}</PageNumber>
  </Pagination>
</GetOrdersRequest>`

      const response = await callTradingApi('GetOrders', xml, token, creds.appId)

      const orderBlocks = [...response.matchAll(/<Order>([\s\S]*?)<\/Order>/g)]
      for (const om of orderBlocks) {
        const orderBlock = om[1] ?? ''

        const orderId       = extractXmlField(orderBlock, 'OrderID')
        const orderStatus   = extractXmlField(orderBlock, 'OrderStatus')
        const paidStatus    = extractXmlField(orderBlock, 'CheckoutStatus')
        const buyerUserId   = extractXmlField(orderBlock, 'BuyerUserID')
        const shippedStatus = extractXmlField(orderBlock, 'ShippedTime') ? 'Shipped' : 'NotShipped'
        const trackingNumber = extractXmlField(orderBlock, 'ShipmentTrackingNumber')

        // Buyer's display name lives in the shipping address block
        const addressBlock = orderBlock.match(/<ShippingAddress>([\s\S]*?)<\/ShippingAddress>/)?.[1] ?? ''
        const buyerName    = extractXmlField(addressBlock, 'Name')

        const txBlocks = [...orderBlock.matchAll(/<Transaction>([\s\S]*?)<\/Transaction>/g)]
        for (const tm of txBlocks) {
          const tx = tm[1] ?? ''

          const transactionId = extractXmlField(tx, 'TransactionID')
          const quantity      = parseInt(extractXmlField(tx, 'QuantityPurchased') || '1', 10)
          const unitPrice     = parseFloat(extractXmlField(tx, 'TransactionPrice') || '0')

          // Item block — listing ID, title, and the SKU we assigned
          const itemBlock = tx.match(/<Item>([\s\S]*?)<\/Item>/)?.[1] ?? ''
          const listingId = extractXmlField(itemBlock, 'ItemID')
          const title     = extractXmlField(itemBlock, 'Title')

          // SKU resolution order matters for variation listings:
          //   Variation<SKU>  — set per-variation at creation (card.id)
          //   Transaction SKU — some payloads surface it at this level
          //   Item<SKU>       — single-listing fallback
          const variationBlock = tx.match(/<Variation>([\s\S]*?)<\/Variation>/)?.[1] ?? ''
          const sku =
            extractXmlField(variationBlock, 'SKU') ||
            extractXmlField(tx, 'SKU') ||
            extractXmlField(itemBlock, 'SKU')

          // Variation display name, e.g. Card Name = "Charizard #006/198"
          const variationName = variationBlock
            ? extractXmlField(variationBlock, 'Value')
            : ''

          const shippingPaid = parseFloat(
            extractXmlField(tx, 'ActualShippingCost') || '0',
          )

          // Final Value Fee where eBay reports it on the transaction
          const feeAmount = parseFloat(extractXmlField(tx, 'FinalValueFee') || '0')

          const saleDate =
            extractXmlField(tx, 'CreatedDate') ||
            extractXmlField(tx, 'PaidTime') ||
            extractXmlField(orderBlock, 'CreatedTime')

          if (!transactionId || !orderId) continue

          all.push({
            orderId,
            transactionId,
            sku,
            listingId,
            title,
            variationName,
            quantity,
            unitPrice,
            linePrice: Math.round(unitPrice * quantity * 100) / 100,
            buyerUserId,
            buyerName,
            shippingPaid,
            feeAmount,
            saleDate,
            orderStatus,
            paidStatus,
            shippedStatus,
            trackingNumber,
          })
        }
      }

      // Continue while eBay reports more pages
      const totalPages = parseInt(extractXmlField(response, 'TotalNumberOfPages') || '1', 10)
      hasMore = pageNumber < totalPages
      pageNumber++
    }

    windowStart = new Date(windowEnd.getTime() + 1000)
  }

  return all
}

// ── Browse API — active listing price lookup ──────────────────────────────────
//
// Uses the REST Browse API (buy/browse/v1) with a client-credentials app token.
// This is the modern eBay REST API — more reliable than the legacy Finding API,
// which returned 503s consistently. No user OAuth required; app token only.
// Returns active FixedPrice listings from eBay UK, filtered by condition.

export interface SoldListing {
  title: string
  price: number
  date:  string
}

// In-process app token cache — avoids fetching a new token on every price lookup.
// Keyed by appId so multi-org setups don't share tokens.
const appTokenCache = new Map<string, { token: string; expires: number }>()

/**
 * Get (or refresh) a client-credentials app token for Browse API calls.
 * Tokens last 2h; we refresh 60s before expiry.
 */
async function getAppToken(appId: string, secret: string): Promise<string> {
  const cached = appTokenCache.get(appId)
  if (cached && cached.expires > Date.now() + 60_000) return cached.token

  const credentials = Buffer.from(`${appId}:${secret}`).toString('base64')
  const res = await fetch(URLS.tokenUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay app token failed (${res.status}): ${text}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  appTokenCache.set(appId, { token: data.access_token, expires: Date.now() + data.expires_in * 1000 })
  return data.access_token
}

// ── Title-based exclusion keywords ────────────────────────────────────────────
//
// BUNDLE_EXCLUSIONS: always applied — removes multi-card lots and sealed product
// regardless of whether the card is graded or raw.
const BUNDLE_EXCLUSIONS = [
  'lot', 'bundle', 'job lot', 'bulk', 'x2', 'x3', 'x4', 'x5',
  'x10', 'x20', 'collection', '2x', '3x', '4x', '5x',
  'booster', 'sealed', 'pack',
]

// RAW_CARD_EXCLUSIONS: applied only for ungraded card lookups.
// Graded slabs sell for 3–10× raw prices and must be excluded from raw queries.
const RAW_CARD_EXCLUSIONS = [
  ...BUNDLE_EXCLUSIONS,
  // Grading companies
  'psa', 'bgs', 'cgc', 'ace grading', 'beckett', 'graded', 'slab',
  'grade ', 'grading', 'gem mt', 'gem mint', 'gem-mint',
  'psa 10', 'psa10', 'cgc 10', 'cgc10', 'bgs 10', 'bgs10',
  'psa 9', 'cgc 9', 'bgs 9',
  'uk grading', 'ags ', 'rate my',
]

/**
 * Fetch active eBay UK listing prices for a card using the Browse API.
 *
 * Uses client-credentials app token — no user OAuth required.
 *
 * For raw cards: excludes graded slabs, bundles, and sealed product by keyword.
 * For graded cards (isGraded=true): includes grader+grade in the search query
 *   so results are specific to that grade, and only bundle/lot filtering applies.
 */
export async function fetchSoldPrices(
  orgId: string,
  cardName: string,
  setCode?: string,
  condition?: string,      // Optional: 'NM' | 'LP' | 'MP' | 'HP' | 'Sealed'
  cardNumber?: string,     // Optional: full format e.g. '181/159' — set total is stripped
  isGraded?: boolean,      // true = professionally graded card
  grader?: string | null,  // e.g. 'PSA', 'BGS', 'CGC', 'ACE Grading'
  grade?: string | null,   // e.g. '10', '9.5'
): Promise<SoldListing[]> {
  const creds = await getCredentials(orgId)
  if (!creds.appId || !creds.secret) throw new Error('eBay App ID not configured')

  const token = await getAppToken(creds.appId, creds.secret)

  // Strip set total from card number for query — "181/159" → "181".
  const queryCardNumber = cardNumber ? cardNumber.split('/')[0] : undefined

  // For graded cards: include grader + grade in the query to match slab listings.
  // For raw cards: include set code for narrower matching.
  const queryParts = isGraded
    ? [cardName, setCode, queryCardNumber, grader, grade]
    : [cardName, setCode, queryCardNumber]
  const query = queryParts.filter(Boolean).join(' ')

  const params = new URLSearchParams({ q: query, limit: '200' })

  let res: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1000))
    res = await fetch(`${URLS.browse}?${params}`, {
      headers: {
        'Authorization':           `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
        'Accept':                  'application/json',
      },
    })
    if (res.ok || res.status < 500) break
  }
  if (!res!.ok) {
    throw new Error(
      res!.status === 503
        ? 'eBay price service temporarily unavailable — please try again in a moment'
        : `eBay Browse API error: HTTP ${res!.status}`,
    )
  }

  const data = await res!.json() as {
    itemSummaries?: Array<{
      title:       string
      price?:      { value: string }
      itemWebUrl?: string
    }>
  }

  const raw = (data.itemSummaries ?? [])
    .map(item => ({
      title: item.title ?? '',
      price: parseFloat(item.price?.value ?? '0'),
      date:  '',
    }))
    .filter(i => i.price > 0)

  // For raw cards: exclude graded slabs + bundles.
  // For graded cards: exclude bundles only — the query already includes the
  //   grader+grade so raw listings won't appear in results anyway.
  const exclusions = isGraded ? BUNDLE_EXCLUSIONS : RAW_CARD_EXCLUSIONS
  const filtered = raw.filter(item => {
    const title = item.title.toLowerCase()
    return !exclusions.some(kw => title.includes(kw))
  })

  // IQR-based outlier removal — drops remaining pricing errors and anomalies.
  // Threshold lowered to 4 (from 8) so IQR fires even on niche cards with few results.
  // 1.5× fence is tighter than classic 3× since active BIN listings skew high.
  if (filtered.length >= 4) {
    const sorted = [...filtered].sort((a, b) => a.price - b.price)
    const q1  = sorted[Math.floor(sorted.length * 0.25)]!.price
    const q3  = sorted[Math.floor(sorted.length * 0.75)]!.price
    const iqr = q3 - q1
    // If IQR is 0 (all items same price), skip fence to avoid filtering everything
    if (iqr > 0) {
      const lo = q1 - 1.5 * iqr
      const hi = q3 + 1.5 * iqr
      return filtered.filter(i => i.price >= lo && i.price <= hi)
    }
    return filtered
  }

  return filtered
}

// ── Listing content helpers (re-exported from shared client-safe module) ───────
export { buildListingTitle, buildListingDescription } from '@/lib/ebay-client'
export type { ListingCardData }                       from '@/lib/ebay-client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;')
}
