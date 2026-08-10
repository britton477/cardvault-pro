// =============================================================================
// CardVault Pro — Net proceeds badge
//
// Shows, beside any list-price input, what YOU actually receive and what the
// buyer pays — both excluding postage. Same component everywhere a price is set
// (Bulk Wizard, stock, eBay), so the number is computed one way, once.
// =============================================================================
'use client'

import { calcNetProceeds, type SellerModel } from '@/lib/fees'
import { cn, formatGBP } from '@/lib/utils'

export function NetProceeds({
  listPrice, sellerModel, className,
}: { listPrice: number | null | undefined; sellerModel: SellerModel; className?: string }) {
  if (!listPrice || listPrice <= 0) return null
  const n = calcNetProceeds(listPrice, sellerModel)

  return (
    <span
      className={cn('text-[11px] text-muted-foreground tabular-nums whitespace-nowrap', className)}
      title="Excludes postage"
    >
      You get <span className="text-green-400 font-semibold">{formatGBP(n.youReceive)}</span>
      {sellerModel.kind === 'private'
        ? <> · buyer pays {formatGBP(n.buyerPaysExclPostage)}</>
        : <> · eBay fee {formatGBP(n.fee)}</>}
    </span>
  )
}
