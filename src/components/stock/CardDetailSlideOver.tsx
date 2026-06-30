'use client'
// =============================================================================
// CardDetailSlideOver — full detail panel for a single card
// Opens from StockTable row click.
// Shows: all metadata, photos, condition/status badges, quick-actions.
// Provides: Edit (→ EditCardModal), Delete (→ ConfirmDialog).
// =============================================================================
import { useState, useEffect } from 'react'
// next/image not used — card photos use plain <img> to support any storage URL
import { Pencil, Trash2, ChevronLeft, ChevronRight, ExternalLink, Tag, Check, ReceiptText, TrendingUp, ShoppingBag, RefreshCw } from 'lucide-react'
import { useDeleteCard, useUpdateCard } from '@/hooks/useCards'
import { useToast } from '@/components/ui/Toast'
import { SlideOver } from '@/components/ui/SlideOver'
import { ConditionBadge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EditCardModal } from '@/components/stock/EditCardModal'
import { ImageUpload } from '@/components/stock/ImageUpload'
import { RecordSaleModal } from '@/components/sales/RecordSaleModal'
import { cn, formatGBP, formatDate } from '@/lib/utils'
import type { Card, EbayPriceResult } from '@/types'

interface CardDetailSlideOverProps {
  card:    Card | null
  onClose: () => void
}

export function CardDetailSlideOver({ card, onClose }: CardDetailSlideOverProps) {
  const [showEdit, setShowEdit]         = useState(false)
  const [showDelete, setShowDelete]     = useState(false)
  const [showSale, setShowSale]         = useState(false)
  const [photoIndex, setPhotoIndex]     = useState(0)
  const [listingPrice, setListingPrice] = useState('')
  const [showPriceSet, setShowPriceSet] = useState(false)
  const [showEbayList, setShowEbayList] = useState(false)
  const [ebayListPrice, setEbayListPrice] = useState('')
  const [fetchingPrice, setFetchingPrice] = useState(false)
  const [listingOnEbay, setListingOnEbay] = useState(false)

  const deleteCard    = useDeleteCard()
  const updateCard    = useUpdateCard(card?.id ?? '')
  const { toast }     = useToast()

  const photos = card?.photos ?? []

  // Reset photo index whenever a different card is opened.
  // Without this, opening Card B after Card A (which had photoIndex=2) would
  // try to render photos[2] on Card B, crashing if Card B has fewer photos.
  useEffect(() => {
    setPhotoIndex(0)
  }, [card?.id])

  // Clamp index so it's always valid even if photos change (e.g. after an upload)
  const safePhotoIndex = photos.length > 0 ? Math.min(photoIndex, photos.length - 1) : 0

  const open = card !== null

  async function handleDelete() {
    if (!card) return
    try {
      await deleteCard.mutateAsync(card.id)
      toast.success('Card deleted', card.card_name)
      setShowDelete(false)
      onClose()
    } catch (err) {
      toast.error('Failed to delete card', err instanceof Error ? err.message : undefined)
    }
  }

  async function handleFetchEbayPrice() {
    if (!card) return
    setFetchingPrice(true)
    try {
      const qs = new URLSearchParams({ card_name: card.card_name })
      if (card.set_code)    qs.set('set_code',    card.set_code)
      if (card.card_number) qs.set('card_number', card.card_number)
      if (card.condition)   qs.set('condition',   card.condition)
      const res = await fetch(`/api/ebay/price?${qs}`)
      if (!res.ok) {
        const errBody = await res.json() as { error?: string }
        throw new Error(errBody.error ?? 'Price lookup failed')
      }
      const data = await res.json() as EbayPriceResult
      if (data.median_price == null) {
        toast.info('No price data', `No recent eBay sales found for "${card.card_name}"`)
        return
      }
      await updateCard.mutateAsync({ ebay_avg_sold: data.median_price })
      // Pre-fill eBay list price suggestion (10% below market)
      const suggested = (data.median_price * 0.9).toFixed(2)
      setEbayListPrice(suggested)
      toast.success(
        'eBay price fetched',
        `${card.card_name} — median £${data.median_price.toFixed(2)} from ${data.price_count} sales${data.cached ? ' (cached)' : ''}`,
      )
    } catch (err) {
      toast.error('Price lookup failed', err instanceof Error ? err.message : undefined)
    } finally {
      setFetchingPrice(false)
    }
  }

  async function handleListOnEbay() {
    if (!card || !ebayListPrice) return
    const price = parseFloat(ebayListPrice)
    if (isNaN(price) || price < 0.01) {
      toast.error('Invalid price', 'Enter a valid listing price')
      return
    }
    setListingOnEbay(true)
    try {
      const res = await fetch('/api/ebay/list', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ listings: [{ card_id: card.id, list_price: price }] }),
      })
      const data = await res.json() as { results: Array<{ success: boolean; listing_id?: string; error?: string }> }
      const result = data.results[0]
      if (!result?.success) throw new Error(result?.error ?? 'Listing failed')
      toast.success('Listed on eBay!', `${card.card_name} — £${price.toFixed(2)} · ID ${result.listing_id}`)
      setShowEbayList(false)
      setEbayListPrice('')
    } catch (err) {
      toast.error('eBay listing failed', err instanceof Error ? err.message : undefined)
    } finally {
      setListingOnEbay(false)
    }
  }

  async function handleSetListedPrice() {
    if (!card || !listingPrice) return
    const price = parseFloat(listingPrice)
    if (isNaN(price) || price < 0) {
      toast.error('Invalid price', 'Enter a valid number')
      return
    }
    try {
      await updateCard.mutateAsync({
        listed_price: price,
        status:       'Listed',
      })
      toast.success('Listed price set', `${card.card_name} → ${formatGBP(price)}`)
      setListingPrice('')
      setShowPriceSet(false)
    } catch (err) {
      toast.error('Failed to update price', err instanceof Error ? err.message : undefined)
    }
  }

  function handlePrevPhoto() {
    setPhotoIndex(i => (i - 1 + photos.length) % photos.length)
  }
  function handleNextPhoto() {
    setPhotoIndex(i => (i + 1) % photos.length)
  }

  if (!card) return null

  const profit =
    card.listed_price != null
      ? card.listed_price - card.purchase_price
      : null

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        title={card.card_name}
        description={[card.set_code, card.card_number ? `#${card.card_number}` : null].filter(Boolean).join(' · ')}
        size="md"
      >
        {/* ── Photo gallery ─────────────────────────────────────── */}
        <div className="relative bg-secondary/30 flex items-center justify-center"
             style={{ minHeight: 220 }}>
          {photos.length > 0 ? (
            <>
              <div className="relative w-full flex items-center justify-center" style={{ height: 220 }}>
                <img
                  src={photos[safePhotoIndex]!.url}
                  alt={card.card_name}
                  className="object-contain w-full h-full"
                  loading="eager"
                />
              </div>
              {photos.length > 1 && (
                <>
                  <button
                    onClick={handlePrevPhoto}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleNextPhoto}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70 transition-colors"
                    aria-label="Next photo"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                    {photos.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setPhotoIndex(i)}
                        className={cn(
                          'h-1.5 rounded-full transition-all',
                          i === safePhotoIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/40',
                        )}
                        aria-label={`Photo ${i + 1}`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground/30 py-10 gap-2">
              <span className="text-5xl select-none" aria-hidden>🃏</span>
              <p className="text-xs text-muted-foreground">No photos uploaded</p>
            </div>
          )}
        </div>

        {/* ── Status row ────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-6 pt-4">
          <ConditionBadge condition={card.condition} />
          <StatusBadge status={card.status} />
          {card.is_graded && card.grader && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset bg-purple-500/15 text-purple-400 ring-purple-500/30">
              {card.grader} {card.grade}
            </span>
          )}
          {card.foil_type && card.foil_type !== 'Normal' && (
            <span className="text-xs text-primary/70 font-medium">{card.foil_type}</span>
          )}
        </div>

        {/* ── Detail fields ─────────────────────────────────────── */}
        <SlideOver.Body>
          <SlideOver.Section title="Card details">
            <SlideOver.Field label="Name"        value={card.card_name} />
            <SlideOver.Field label="Set"         value={card.set_code || null} />
            <SlideOver.Field label="Number"      value={card.card_number ? `#${card.card_number}` : null} />
            <SlideOver.Field label="Language"    value={card.language || null} />
            <SlideOver.Field label="Qty in stock" value={card.qty} />
            {card.is_graded && (
              <>
                <SlideOver.Field label="Grader" value={card.grader} />
                <SlideOver.Field label="Grade"  value={card.grade} />
              </>
            )}
          </SlideOver.Section>

          <SlideOver.Section title="Pricing">
            <SlideOver.Field label="Purchase price" value={formatGBP(card.purchase_price)} />
            <SlideOver.Field
              label="Listed price"
              value={card.listed_price != null ? (
                <span className="text-primary font-medium">{formatGBP(card.listed_price)}</span>
              ) : <span className="text-muted-foreground">Not listed</span>}
            />
            {profit !== null && (
              <SlideOver.Field
                label="Potential profit"
                value={
                  <span className={profit >= 0 ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>
                    {formatGBP(profit, { showSign: true })}
                  </span>
                }
              />
            )}
            <SlideOver.Field
              label="eBay market price"
              value={
                <div className="flex items-center gap-2">
                  {card.ebay_avg_sold != null ? (
                    <span className={cn(
                      'font-medium',
                      card.ebay_avg_sold > card.purchase_price ? 'text-green-400' : 'text-red-400',
                    )}>
                      {formatGBP(card.ebay_avg_sold)}
                      {card.purchase_price > 0 && (
                        <span className="ml-1 text-xs opacity-70">
                          ({card.ebay_avg_sold >= card.purchase_price ? '+' : ''}
                          {((card.ebay_avg_sold - card.purchase_price) / card.purchase_price * 100).toFixed(0)}%)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-sm">Not fetched</span>
                  )}
                  <button
                    onClick={() => void handleFetchEbayPrice()}
                    disabled={fetchingPrice}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
                    title="Fetch latest eBay market price"
                  >
                    <RefreshCw className={cn('h-3 w-3', fetchingPrice && 'animate-spin')} />
                    {fetchingPrice ? 'Fetching…' : 'Refresh'}
                  </button>
                </div>
              }
            />
          </SlideOver.Section>

          <SlideOver.Section title="Purchase info">
            <SlideOver.Field label="Date"   value={card.purchase_date ? formatDate(card.purchase_date) : null} />
            <SlideOver.Field label="Source" value={card.source || null} />
          </SlideOver.Section>

          {/* Photos management */}
          <SlideOver.Section title="Photos">
            <ImageUpload
              cardId={card.id}
              photos={card.photos ?? []}
            />
          </SlideOver.Section>

          {card.notes && (
            <SlideOver.Section title="Notes">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{card.notes}</p>
            </SlideOver.Section>
          )}

          {/* eBay listing link */}
          {card.ebay_listing_id && (
            <a
              href={`https://www.${process.env['NEXT_PUBLIC_EBAY_ENV'] === 'production' ? '' : 'sandbox.'}ebay.co.uk/itm/${card.ebay_listing_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              View eBay listing
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t border-border/50">
            <p>Added {formatDate(card.created_at)}</p>
            {card.updated_at !== card.created_at && (
              <p>Updated {formatDate(card.updated_at)}</p>
            )}
          </div>
        </SlideOver.Body>

        {/* ── Footer actions ────────────────────────────────────── */}
        <SlideOver.Footer>
          {/* List on eBay flow */}
          {showEbayList ? (
            <div className="flex items-center gap-2 flex-1">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                prefix="£"
                value={ebayListPrice}
                onChange={e => setEbayListPrice(e.target.value)}
                wrapperClassName="flex-1"
                aria-label="eBay listing price"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleListOnEbay()
                  if (e.key === 'Escape') setShowEbayList(false)
                }}
              />
              <Button
                size="sm"
                onClick={() => void handleListOnEbay()}
                loading={listingOnEbay}
                iconLeft={!listingOnEbay ? <Check className="h-3.5 w-3.5" /> : undefined}
              >
                List
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowEbayList(false)}
              >
                Cancel
              </Button>
            </div>
          ) : showPriceSet ? (
            /* Local listed price quick-set */
            <div className="flex items-center gap-2 flex-1">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                prefix="£"
                value={listingPrice}
                onChange={e => setListingPrice(e.target.value)}
                wrapperClassName="flex-1"
                aria-label="Set listed price"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') void handleSetListedPrice()
                  if (e.key === 'Escape') setShowPriceSet(false)
                }}
              />
              <Button
                size="sm"
                onClick={() => void handleSetListedPrice()}
                loading={updateCard.isPending}
                iconLeft={!updateCard.isPending ? <Check className="h-3.5 w-3.5" /> : undefined}
              >
                Set
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowPriceSet(false); setListingPrice('') }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDelete(true)}
                iconLeft={<Trash2 className="h-3.5 w-3.5" />}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setListingPrice(card.listed_price != null ? String(card.listed_price) : '')
                  setShowPriceSet(true)
                }}
                iconLeft={<Tag className="h-3.5 w-3.5" />}
              >
                Set price
              </Button>
              {card.status === 'In Stock' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Pre-fill with ebay_avg_sold * 0.9 or existing listed price
                    const suggestion = card.ebay_avg_sold
                      ? (card.ebay_avg_sold * 0.9).toFixed(2)
                      : card.listed_price != null ? String(card.listed_price) : ''
                    setEbayListPrice(suggestion)
                    setShowEbayList(true)
                  }}
                  iconLeft={<ShoppingBag className="h-3.5 w-3.5" />}
                >
                  List on eBay
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowSale(true)}
                iconLeft={<ReceiptText className="h-3.5 w-3.5" />}
              >
                Record sale
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowEdit(true)}
                iconLeft={<Pencil className="h-3.5 w-3.5" />}
              >
                Edit
              </Button>
            </>
          )}
        </SlideOver.Footer>
      </SlideOver>

      {/* ── Edit modal (rendered outside SlideOver to avoid stacking context issues) */}
      <EditCardModal
        card={showEdit ? card : null}
        onClose={() => setShowEdit(false)}
      />

      {/* ── Record sale modal (pre-filled from this card) ────────────── */}
      <RecordSaleModal
        open={showSale}
        onClose={() => setShowSale(false)}
        prefill={card}
      />

      {/* ── Delete confirmation ───────────────────────────────── */}
      <ConfirmDialog
        open={showDelete}
        title="Delete card?"
        description={`"${card.card_name}" will be permanently removed from your stock. This cannot be undone.`}
        confirmLabel="Delete card"
        loading={deleteCard.isPending}
        onConfirm={handleDelete}
        onCancel={() => setShowDelete(false)}
      />
    </>
  )
}
