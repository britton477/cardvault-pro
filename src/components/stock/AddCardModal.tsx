'use client'
// =============================================================================
// AddCardModal — full form for creating a new card in stock
// Uses Radix Dialog + useCreateCard mutation hook + design system components
// =============================================================================
import * as Dialog from '@radix-ui/react-dialog'
import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Search, Sparkles } from 'lucide-react'
import { useCreateCard } from '@/hooks/useCards'
import { useLots }       from '@/hooks/useLots'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import type { CreateCardInput, CardCondition } from '@/types'
import { CONDITIONS, FOIL_TYPES, LANGUAGES, SOURCES, GRADERS } from './cardConstants'
import type { TcgCard } from '@/app/api/tcg/search/route'

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  card_name:      string
  set_code:       string
  card_number:    string
  condition:      CardCondition
  foil_type:      string
  language:       string
  is_graded:      boolean
  grader:         string
  grade:          string
  qty:            number
  purchase_price: string
  purchase_date:  string
  source:         string
  notes:          string
  lot_id:         string
}

const EMPTY_FORM: FormState = {
  card_name:      '',
  set_code:       '',
  card_number:    '',
  condition:      'NM',
  foil_type:      'Normal',
  language:       'EN',
  is_graded:      false,
  grader:         '',
  grade:          '',
  qty:            1,
  purchase_price: '',
  purchase_date:  new Date().toISOString().split('T')[0] ?? '',
  source:         '',
  notes:          '',
  lot_id:         '',
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AddCardModalProps {
  open:         boolean
  onClose:      () => void
  defaultLotId?: string   // pre-selects a lot when opened from LotDetailSlideOver
}

export function AddCardModal({ open, onClose, defaultLotId }: AddCardModalProps) {
  const [form, setForm]           = useState<FormState>(() => ({
    ...EMPTY_FORM,
    lot_id: defaultLotId ?? '',
  }))
  const [errors, setErrors]       = useState<Partial<Record<keyof FormState, string>>>({})
  const [ebayPrice, setEbayPrice] = useState<number | null>(null)
  const [ebayLoading, setEbayLoading] = useState(false)

  // TCG auto-fill state
  const [tcgResults, setTcgResults]   = useState<TcgCard[]>([])
  const [tcgLoading, setTcgLoading]   = useState(false)
  const [showTcgDrop, setShowTcgDrop] = useState(false)
  const tcgDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameRef        = useRef<HTMLInputElement>(null)
  const dropRef        = useRef<HTMLDivElement>(null)

  const createCard     = useCreateCard()
  const { toast }      = useToast()
  const { data: lotsData } = useLots()

  // ── TCG search (debounced 350ms) ─────────────────────────────────────────────
  const searchTcg = useCallback(async (query: string) => {
    if (query.trim().length < 2) { setTcgResults([]); setShowTcgDrop(false); return }
    setTcgLoading(true)
    try {
      const res  = await fetch(`/api/tcg/search?q=${encodeURIComponent(query)}`)
      const data = await res.json() as { cards?: TcgCard[] }
      setTcgResults(data.cards ?? [])
      setShowTcgDrop((data.cards?.length ?? 0) > 0)
    } catch {
      setTcgResults([])
    } finally {
      setTcgLoading(false)
    }
  }, [])

  function handleNameChange(value: string) {
    set('card_name', value)
    if (tcgDebounceRef.current) clearTimeout(tcgDebounceRef.current)
    tcgDebounceRef.current = setTimeout(() => void searchTcg(value), 350)
  }

  function applyTcgCard(card: TcgCard) {
    setForm(f => ({
      ...f,
      card_name:   card.name,
      set_code:    card.set_code,
      card_number: card.number,
    }))
    setTcgResults([])
    setShowTcgDrop(false)
    setErrors(e => ({ ...e, card_name: undefined }))
  }

  // Close TCG dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowTcgDrop(false)
      }
    }
    if (showTcgDrop) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTcgDrop])

  // ── Field helper ─────────────────────────────────────────────────────────────

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  function validate(): boolean {
    const errs: Partial<Record<keyof FormState, string>> = {}
    if (!form.card_name.trim())        errs.card_name     = 'Card name is required'
    if (!form.purchase_price)          errs.purchase_price = 'Purchase price is required'
    const price = parseFloat(form.purchase_price)
    if (isNaN(price) || price < 0)    errs.purchase_price = 'Enter a valid price'
    if (form.qty < 1)                  errs.qty            = 'Quantity must be at least 1'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── eBay price lookup ─────────────────────────────────────────────────────────

  async function handleEbayLookup() {
    if (!form.card_name.trim()) {
      setErrors(prev => ({ ...prev, card_name: 'Enter a card name first' }))
      return
    }
    setEbayLoading(true)
    setEbayPrice(null)
    try {
      const qs = new URLSearchParams({ card_name: form.card_name })
      if (form.set_code) qs.set('set_code', form.set_code)
      const res = await fetch(`/api/ebay/price?${qs}`)
      if (res.ok) {
        const data = await res.json() as { median_price: number | null }
        setEbayPrice(data.median_price)
        if (data.median_price === null) {
          toast.info('No eBay sales data found for this card')
        }
      } else {
        toast.error('eBay lookup failed', 'Could not fetch price data')
      }
    } catch {
      toast.error('eBay lookup failed', 'Check your connection and try again')
    } finally {
      setEbayLoading(false)
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    const input: CreateCardInput = {
      card_name:      form.card_name.trim(),
      set_code:       form.set_code.trim(),
      card_number:    form.card_number.trim(),
      condition:      form.condition,
      foil_type:      form.foil_type,
      language:       form.language,
      is_graded:      form.is_graded,
      grader:         form.is_graded && form.grader ? form.grader : undefined,
      grade:          form.is_graded && form.grade  ? form.grade  : undefined,
      qty:            form.qty,
      purchase_price: parseFloat(form.purchase_price),
      purchase_date:  form.purchase_date || undefined,
      source:         form.source,
      notes:          form.notes.trim(),
      lot_id:         form.lot_id || undefined,
    }

    try {
      await createCard.mutateAsync(input)
      toast.success('Card added to stock', form.card_name.trim())
      handleReset()
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined
      // Plan limit hit — give a specific, actionable message
      if (message?.includes('card limit') || message?.includes('Upgrade')) {
        toast.error('Card limit reached', message)
      } else {
        toast.error('Failed to add card', message)
      }
    }
  }

  // ── Reset + close ──────────────────────────────────────────────────────────────

  function handleReset() {
    setForm({ ...EMPTY_FORM, lot_id: defaultLotId ?? '' })
    setErrors({})
    setEbayPrice(null)
    setTcgResults([])
    setShowTcgDrop(false)
    if (tcgDebounceRef.current) clearTimeout(tcgDebounceRef.current)
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      handleReset()
      onClose()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm animate-in fade-in-0" />

        <Dialog.Content
          className={cn(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-2xl max-h-[90vh] overflow-y-auto',
            'bg-card border border-border rounded-xl shadow-2xl',
            'animate-in fade-in-0 zoom-in-95',
          )}
          onOpenAutoFocus={e => { e.preventDefault(); nameRef.current?.focus() }}
          aria-describedby="add-card-desc"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
            <Dialog.Title className="text-lg font-semibold">Add card to stock</Dialog.Title>
            <p id="add-card-desc" className="sr-only">
              Fill in the card details and click "Add to stock" to save.
            </p>
            <Dialog.Close
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-5">

            {/* ── Card name + TCG auto-fill + eBay lookup ─────── */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">
                Card name <span className="text-destructive" aria-hidden>*</span>
              </label>
              <div className="flex gap-2">
                {/* Name input with TCG suggestion dropdown */}
                <div className="relative flex-1" ref={dropRef}>
                  <input
                    ref={nameRef}
                    type="text"
                    value={form.card_name}
                    onChange={e => handleNameChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setShowTcgDrop(false) }}
                    placeholder="e.g. Charizard — type to auto-fill"
                    aria-required
                    aria-invalid={!!errors.card_name}
                    aria-autocomplete="list"
                    aria-expanded={showTcgDrop}
                    className={cn(
                      'w-full px-3 py-2 rounded-md border bg-input text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground',
                      errors.card_name ? 'border-destructive' : 'border-border',
                    )}
                  />
                  {/* Loading spinner inside input */}
                  {tcgLoading && (
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                      <div className="h-3.5 w-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {/* TCG results dropdown */}
                  {showTcgDrop && tcgResults.length > 0 && (
                    <div className={cn(
                      'absolute z-50 left-0 right-0 top-full mt-1',
                      'bg-card border border-border rounded-lg shadow-xl overflow-hidden',
                      'max-h-64 overflow-y-auto',
                    )}>
                      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border bg-secondary/30">
                        <Sparkles className="h-3 w-3 text-primary" />
                        <span className="text-[11px] text-muted-foreground font-medium">TCG auto-fill</span>
                      </div>
                      {tcgResults.map(card => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => applyTcgCard(card)}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2 text-left',
                            'hover:bg-secondary/60 focus:bg-secondary/60 transition-colors',
                            'focus:outline-none',
                          )}
                        >
                          {card.image_small && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={card.image_small}
                              alt=""
                              className="h-9 w-auto rounded object-contain flex-shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{card.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {card.set_name} · #{card.number}
                              {card.rarity ? ` · ${card.rarity}` : ''}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  loading={ebayLoading}
                  onClick={handleEbayLookup}
                  iconLeft={!ebayLoading ? <Search className="h-3.5 w-3.5" /> : undefined}
                >
                  eBay price
                </Button>
              </div>
              {errors.card_name && (
                <p className="text-xs text-destructive" role="alert">{errors.card_name}</p>
              )}
              {ebayPrice !== null && (
                <p className="text-xs text-green-400">
                  eBay median sold: <strong>£{ebayPrice.toFixed(2)}</strong>
                  {' — '}
                  <button
                    type="button"
                    onClick={() => set('purchase_price', ebayPrice.toFixed(2))}
                    className="underline hover:no-underline focus:outline-none focus:ring-1 focus:ring-ring rounded"
                  >
                    use as purchase price
                  </button>
                </p>
              )}
            </div>

            {/* ── Set + card number ─────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Set code"
                value={form.set_code}
                onChange={e => set('set_code', e.target.value.toUpperCase())}
                placeholder="e.g. SV01"
                maxLength={50}
              />
              <Input
                label="Card number"
                value={form.card_number}
                onChange={e => set('card_number', e.target.value)}
                placeholder="e.g. 006/165"
                maxLength={50}
              />
            </div>

            {/* ── Condition + foil + language ───────────────────── */}
            <div className="grid grid-cols-3 gap-4">
              <Select
                label="Condition"
                value={form.condition}
                onChange={e => set('condition', e.target.value as CardCondition)}
                options={CONDITIONS}
              />
              <Select
                label="Foil type"
                value={form.foil_type}
                onChange={e => set('foil_type', e.target.value)}
                options={FOIL_TYPES.map(f => ({ value: f, label: f }))}
              />
              <Select
                label="Language"
                value={form.language}
                onChange={e => set('language', e.target.value)}
                options={LANGUAGES}
              />
            </div>

            {/* ── Price + qty + date ────────────────────────────── */}
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Purchase price"
                required
                type="number"
                min="0"
                step="0.01"
                value={form.purchase_price}
                onChange={e => set('purchase_price', e.target.value)}
                placeholder="0.00"
                prefix="£"
                error={errors.purchase_price}
              />
              <Input
                label="Quantity"
                type="number"
                min="1"
                max="9999"
                value={String(form.qty)}
                onChange={e => set('qty', parseInt(e.target.value, 10) || 1)}
                error={errors.qty}
              />
              <Input
                label="Purchase date"
                type="date"
                value={form.purchase_date}
                onChange={e => set('purchase_date', e.target.value)}
              />
            </div>

            {/* ── Graded toggle ────────────────────────────────── */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.is_graded}
                onClick={() => set('is_graded', !form.is_graded)}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
                  form.is_graded ? 'bg-primary' : 'bg-secondary',
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform',
                    form.is_graded ? 'translate-x-4' : 'translate-x-0',
                  )}
                />
              </button>
              <span
                className="text-sm font-medium cursor-pointer select-none"
                onClick={() => set('is_graded', !form.is_graded)}
              >
                Graded card (PSA / BGS / CGC)
              </span>
            </div>

            {form.is_graded && (
              <div className="grid grid-cols-2 gap-4 pl-12">
                <Select
                  label="Grader"
                  value={form.grader}
                  onChange={e => set('grader', e.target.value)}
                  options={GRADERS.map(g => ({ value: g, label: g }))}
                  placeholder="Select grader"
                />
                <Input
                  label="Grade"
                  value={form.grade}
                  onChange={e => set('grade', e.target.value)}
                  placeholder="e.g. 10, 9.5"
                />
              </div>
            )}

            {/* ── Source + notes ─────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Source"
                value={form.source}
                onChange={e => set('source', e.target.value)}
                options={SOURCES.map(s => ({ value: s, label: s }))}
                placeholder="Select source"
              />
              <Input
                label="Notes"
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Any additional info…"
                maxLength={500}
              />
            </div>

            {/* ── Purchase lot (optional) ─────────────────────────── */}
            {(lotsData?.data?.length ?? 0) > 0 && (
              <Select
                label="Purchase lot"
                value={form.lot_id}
                onChange={e => set('lot_id', e.target.value)}
                options={(lotsData?.data ?? []).map(l => ({ value: l.id, label: l.name }))}
                placeholder="No lot"
              />
            )}

            {/* ── Footer ────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                loading={createCard.isPending}
              >
                Add to stock
              </Button>
            </div>

          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
