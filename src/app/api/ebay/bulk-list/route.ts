// =============================================================================
// POST /api/ebay/bulk-list
//
// Lists multiple cards on eBay from the BulkActionBar selection.
// Prices are pulled from cards.listed_price — cards without a price are
// returned in `skipped` so the user can set prices and retry.
//
// Cards are processed SEQUENTIALLY (not Promise.allSettled in parallel)
// to respect eBay's API rate limits. With 50 cards this is slower but safe.
//
// Returns:
//   succeeded: [{ card_id, card_name, listing_id }]
//   failed:    [{ card_id, card_name, error }]
//   skipped:   [{ card_id, card_name, reason }]
// =============================================================================
import { type NextRequest } from 'next/server'
import { ZodError }         from 'zod'
import { createAdminClient }            from '@/lib/supabase/server'
import { requireAuth, ok, serverError, validationError } from '@/lib/api'
import { listItem, getCredentials }     from '@/lib/ebay'
import { writeAuditLog }                from '@/lib/audit'
import { BulkEbayListSchema }           from '@/types/validation'

interface SuccessResult { card_id: string; card_name: string; listing_id: string }
interface FailedResult  { card_id: string; card_name: string; error: string      }
interface SkippedResult { card_id: string; card_name: string; reason: string     }

export async function POST(request: NextRequest) {
  try {
    const { orgId, user } = await requireAuth()
    const body  = await request.json() as unknown
    const input = BulkEbayListSchema.parse(body)

    const db = createAdminClient()

    // ── Verify eBay is connected ───────────────────────────────────────────────
    const creds = await getCredentials(orgId).catch(() => null)
    if (!creds?.accessToken || !creds?.refreshToken) {
      return ok({
        succeeded: [],
        failed:    [],
        skipped:   input.card_ids.map(id => ({
          card_id:   id,
          card_name: 'Unknown',
          reason:    'eBay not connected',
        })),
        ebay_not_connected: true,
      })
    }

    // ── Load org settings (policy IDs) ─────────────────────────────────────────
    const { data: settings } = await db
      .from('org_settings')
      .select('*')
      .eq('org_id', orgId)
      .single()

    if (!settings?.ebay_fulfillment_policy_id) {
      return serverError(new Error('eBay policy IDs not configured in Settings'))
    }

    // ── Load cards ─────────────────────────────────────────────────────────────
    const { data: cards, error: cardsErr } = await db
      .from('cards')
      .select('*, photos:card_photos(url)')
      .in('id', input.card_ids)
      .eq('org_id', orgId)
      .is('deleted_at', null)

    if (cardsErr) throw cardsErr

    const cardMap = new Map((cards ?? []).map(c => [c.id as string, c]))

    const succeeded: SuccessResult[] = []
    const failed:    FailedResult[]  = []
    const skipped:   SkippedResult[] = []

    // ── Process sequentially ──────────────────────────────────────────────────
    for (const card_id of input.card_ids) {
      const card = cardMap.get(card_id)

      // Not found in org
      if (!card) {
        skipped.push({ card_id, card_name: 'Unknown', reason: 'Card not found' })
        continue
      }

      const card_name = card.card_name as string

      // Already listed
      if (card.status === 'Listed' && card.ebay_listing_id) {
        skipped.push({ card_id, card_name, reason: 'Already listed on eBay' })
        continue
      }

      // No price set
      if (!card.listed_price) {
        skipped.push({ card_id, card_name, reason: 'No price set — use Set Price first' })
        continue
      }

      // Attempt listing
      try {
        const photoUrls = ((card.photos ?? []) as Array<{ url: string }>).map(p => p.url)

        const title = [
          card.card_name,
          card.set_code,
          card.card_number,
          card.condition,
          card.foil_type !== 'Normal' ? card.foil_type : '',
          card.is_graded ? `${card.grader as string} ${card.grade as string}` : '',
        ].filter(Boolean).join(' ').slice(0, 80)

        const description = [
          `${card.card_name as string} — ${card.set_code as string} #${card.card_number as string}`,
          `Condition: ${card.condition as string}`,
          card.foil_type !== 'Normal'  ? `Foil: ${card.foil_type as string}` : '',
          card.is_graded               ? `Graded: ${card.grader as string} ${card.grade as string}` : '',
          card.notes                   ? String(card.notes) : '',
          '\nListed via CardVault Pro',
        ].filter(Boolean).join('\n')

        const listingId = await listItem({
          orgId,
          title,
          description,
          condition:           card.condition as string,
          price:               card.listed_price as number,
          quantity:            1,
          photoUrls,
          location:            (settings.item_location as string | null) ?? 'United Kingdom',
          fulfillmentPolicyId: settings.ebay_fulfillment_policy_id as string,
          paymentPolicyId:     settings.ebay_payment_policy_id     as string,
          returnPolicyId:      settings.ebay_return_policy_id      as string,
        })

        // Update card record
        await db
          .from('cards')
          .update({
            status:          'Listed',
            listed_on:       'eBay',
            ebay_listing_id: listingId,
            last_edited_by:  user.id,
            updated_at:      new Date().toISOString(),
          })
          .eq('id', card_id)

        succeeded.push({ card_id, card_name, listing_id: listingId })
      } catch (err) {
        failed.push({
          card_id,
          card_name,
          error: err instanceof Error ? err.message : 'Listing failed',
        })
      }
    }

    // ── Audit log ──────────────────────────────────────────────────────────────
    void writeAuditLog({
      orgId,
      userId:     user.id,
      action:     'ebay.bulk_list',
      entityType: 'card',
      after: {
        succeeded: succeeded.length,
        failed:    failed.length,
        skipped:   skipped.length,
        ids:       input.card_ids,
      },
    })

    return ok({ succeeded, failed, skipped })
  } catch (err) {
    if (err instanceof ZodError)  return validationError(err)
    if (err instanceof Response)  return err
    return serverError(err)
  }
}
