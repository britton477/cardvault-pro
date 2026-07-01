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
  const match = xml.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`))
  return match?.[1] ?? ''
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
    <Pagination>
      <EntriesPerPage>200</EntriesPerPage>
      <PageNumber>1</PageNumber>
    </Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`

  const response = await callTradingApi('GetMyeBaySelling', xml, token, creds.appId)

  const items = [...response.matchAll(/<Item>([\s\S]*?)<\/Item>/g)]
  return items.map(m => {
    const block = m[1] ?? ''
    const listingId = extractXmlField(block, 'ItemID')
    return {
      listingId,
      title:      extractXmlField(block, 'Title'),
      price:      parseFloat(extractXmlField(block, 'CurrentPrice') || '0'),
      quantity:   parseInt(extractXmlField(block, 'Quantity') || '1', 10),
      watchCount: parseInt(extractXmlField(block, 'WatchCount') || '0', 10),
      viewCount:  parseInt(extractXmlField(block, 'HitCount') || '0', 10),
      startTime:  extractXmlField(block, 'ListingDetails>StartTime').replace('ListingDetails>', '') ||
                  extractXmlField(block, 'StartTime'),
      endTime:    extractXmlField(block, 'ListingDetails>EndTime').replace('ListingDetails>', '') ||
                  extractXmlField(block, 'EndTime'),
      listingUrl: IS_SANDBOX
        ? `https://www.sandbox.ebay.co.uk/itm/${listingId}`
        : `https://www.ebay.co.uk/itm/${listingId}`,
    }
  }).filter(l => l.listingId && l.price > 0)
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

// Maps our condition codes to Browse API conditionId filter values for
// Pokémon TCG category 183454.
//
// IMPORTANT: this category uses a DIFFERENT condition ID system from standard eBay:
//   4000 = Ungraded  (all raw cards — NM / LP / MP / HP)
//   2750 = Professionally Graded  (PSA, BGS, CGC slabs)
//   1000 = New  (sealed product)
//
// The standard eBay condition IDs (2750=Like New, 2500=Very Good, etc.) do NOT
// apply here. Using them returns the wrong listings — 2750 in this category is
// graded slabs, not raw NM cards.
//
// Sub-conditions (NM vs LP) are set via ConditionDescriptors on listings and
// are NOT filterable in the Browse API, so all raw conditions map to 4000.
const BROWSE_CONDITION_IDS: Record<string, string> = {
  NM:     '4000',  // Ungraded
  LP:     '4000',  // Ungraded
  MP:     '4000',  // Ungraded
  HP:     '4000',  // Ungraded
  Sealed: '1000',  // New
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

/**
 * Fetch active eBay UK listing prices for a card using the Browse API.
 *
 * Uses client-credentials app token — no user OAuth required.
 * Filters to FixedPrice listings and optionally narrows by condition.
 * IQR outlier removal (1.5×) drops bundles and overpriced BIN listings.
 */
export async function fetchSoldPrices(
  orgId: string,
  cardName: string,
  setCode?: string,
  condition?: string,   // Optional: 'NM' | 'LP' | 'MP' | 'HP' | 'Sealed'
  cardNumber?: string,  // Optional: e.g. '025' — narrows results to specific print
): Promise<SoldListing[]> {
  const creds = await getCredentials(orgId)
  if (!creds.appId || !creds.secret) throw new Error('eBay App ID not configured')

  const token = await getAppToken(creds.appId, creds.secret)

  // Include set_code in the query — sellers include it in listing titles
  // (e.g. "Dreepy M2A 211/193") so it narrows results to the correct print.
  const query = [cardName, setCode, cardNumber].filter(Boolean).join(' ')

  // Base filters: always fixed price, always scoped to Pokémon TCG (183454)
  const baseFilter    = 'buyingOptions:{FIXED_PRICE},categoryIds:{183454}'
  const conditionId   = condition ? BROWSE_CONDITION_IDS[condition] : undefined
  const filterWithCond = conditionId
    ? `${baseFilter},conditionIds:{${conditionId}}`
    : baseFilter

  async function browseSearch(filter: string) {
    const params = new URLSearchParams({ q: query, limit: '50', filter })
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
    return res!.json() as Promise<{
      itemSummaries?: Array<{
        title:       string
        price?:      { value: string }
        itemWebUrl?: string
      }>
    }>
  }

  // First attempt: with condition filter (excludes graded slabs / sealed).
  // Fallback: without condition filter — some sellers don't set conditionId
  // correctly, which would cause zero results on the filtered search.
  let data = await browseSearch(filterWithCond)
  if (conditionId && !(data.itemSummaries?.length)) {
    data = await browseSearch(baseFilter)
  }

  const raw = (data.itemSummaries ?? [])
    .map(item => ({
      title: item.title ?? '',
      price: parseFloat(item.price?.value ?? '0'),
      date:  '',
    }))
    .filter(i => i.price > 0)

  // IQR-based outlier removal — drops bundles, slabs, and pricing errors.
  // 1.5× fence is tighter than the classic 3× since active BIN listings skew high.
  if (raw.length >= 8) {
    const sorted = [...raw].sort((a, b) => a.price - b.price)
    const q1 = sorted[Math.floor(sorted.length * 0.25)]!.price
    const q3 = sorted[Math.floor(sorted.length * 0.75)]!.price
    const iqr = q3 - q1
    const lo  = q1 - 1.5 * iqr
    const hi  = q3 + 1.5 * iqr
    return raw.filter(i => i.price >= lo && i.price <= hi)
  }

  return raw
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
