'use client'
// =============================================================================
// EditCardModal — pre-filled form for editing an existing card
// Accepts card prop (null = closed). Uses useUpdateCard mutation.
// Shares field constants with AddCardModal via cardConstants.ts.
// =============================================================================
import * as Dialog from '@radix-ui/react-dialog'
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useUpdateCard } from '@/hooks/useCards'
import { useToast } from '@/components/ui/Toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import { CONDITIONS, FOIL_TYPES, LANGUAGES, SOURCES, GRADERS } from './cardConstants'
import type { Card, UpdateCardInput, CardCondition, CardStatus } from '@/types'

// ── Form state ─────────────────────────────────────────────────────────────────

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
  status:         CardStatus
  purchase_price: string
  purchase_date:  string
  listed_price:   string
  source:         string
  notes:          string
}

function cardToForm(card: Card): FormState {
  return {
    card_name:      card.card_name,
    set_code:       card.set_code  ?? '',
    card_number:    card.card_number ?? '',
    condition:      card.condition,
    foil_type:      card.foil_type ?? 'Normal',
    language:       card.language ?? 'EN',
    is_graded:      card.is_graded,
    grader:         card.grader ?? '',
    grade:          card.grade  ?? '',
    qty:            card.qty,
    status:         card.status,
    purchase_price: String(card.purchase_price ?? ''),
    purchase_date:  card.purchase_date ?? '',
    listed_price:   card.listed_price != null ? String(card.listed_price) : '',
    source:         card.source ?? '',
    notes:          card.notes  ?? '',
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

interface EditCardModalProps {
  /** Pass a Card to open, null to close */
  card:    Card | null
  onClose: () => void
}

export function EditCardModal({ card, onClose }: EditCardModalProps) {
  const [form, setForm]     = useState<FormState | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  const updateCard    = useUpdateCard(card?.id ?? '')
  const { toast }     = useToast()
  const open          = card !== null

  // Sync form state whenever a new card is passed in
  useEffect(() => {
    if (card) {
      setForm(cardToForm(card))
      setErrors({})
    }
  }, [card?.id]) // only re-init when card id changes

  // ── Field helper ─────────────────────────────────────────────────────────────

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => prev ? { ...prev, [key]: value } : prev)
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: undefined }))
  }

  // ── Validation ────────────────────────────────────────────────────────────────

  function validate(): boolean {
    if (!form) return false
    const errs: Partial<Record<keyof FormState, string>> = {}
    if (!form.card_name.trim())     errs.card_name      = 'Card name is required'
    if (!form.purchase_price)       errs.purchase_price = 'Purchase price is required'
    const price = parseFloat(form.purchase_price)
    if (isNaN(price) || price < 0) errs.purchase_price  = 'Enter a valid price'
    if (form.qty < 1)              errs.qty             = 'Quantity must be at least 1'
    if (form.listed_price) {
      const lp = parseFloat(form.listed_price)
      if (isNaN(lp) || lp < 0)    errs.listed_price    = 'Enter a valid price'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !card) return
    if (!validate()) return

    const input: UpdateCardInput = {
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
      status:         form.status,
      purchase_price: parseFloat(form.purchase_price),
      purchase_date:  form.purchase_date || undefined,
      listed_price:   form.listed_price ? parseFloat(form.listed_price) : null,
      source:         form.source,
      notes:          form.notes.trim(),
    }

    try {
      await updateCard.mutateAsync(input)
      toast.success('Card updated', form.card_name.trim())
      onClose()
    } catch (err) {
      toast.error('Failed to save changes', err instanceof Error ? err.message : undefined)
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) onClose()
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!form) return null

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm animate-in fade-in-0" />

        <Dialog.Content
          className={cn(
            'fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-2xl max-h-[90vh] overflow-y-auto',
            'bg-card border border-border rounded-xl shadow-2xl',
            'animate-in fade-in-0 zoom-in-95',
          )}
          aria-describedby="edit-card-desc"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
            <Dialog.Title className="text-lg font-semibold">Edit card</Dialog.Title>
            <p id="edit-card-desc" className="sr-only">Edit details for {card?.card_name}</p>
            <Dialog.Close
              className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} noValidate className="px-6 py-5 space-y-5">

            {/* ── Card name ───────────────────────────────────── */}
            <Input
              label="Card name"
              required
              value={form.card_name}
              onChange={e => set('card_name', e.target.value)}
              placeholder="e.g. Charizard"
              error={errors.card_name}
            />

            {/* ── Set + number ─────────────────────────────────── */}
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

            {/* ── Status + qty ─────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Status"
                value={form.status}
                onChange={e => set('status', e.target.value as CardStatus)}
                options={[
                  { value: 'In Stock', label: 'In Stock' },
                  { value: 'Listed',   label: 'Listed' },
                  { value: 'Sold',     label: 'Sold' },
                ]}
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
            </div>

            {/* ── Purchase price + date ─────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
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
                label="Purchase date"
                type="date"
                value={form.purchase_date}
                onChange={e => set('purchase_date', e.target.value)}
              />
            </div>

            {/* ── Listed price ─────────────────────────────────── */}
            <Input
              label="Listed price"
              type="number"
              min="0"
              step="0.01"
              value={form.listed_price}
              onChange={e => set('listed_price', e.target.value)}
              placeholder="Leave blank if not listed"
              prefix="£"
              error={errors.listed_price}
              hint="The price you have this listed for sale"
            />

            {/* ── Graded toggle ─────────────────────────────────── */}
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
                <span className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform',
                  form.is_graded ? 'translate-x-4' : 'translate-x-0',
                )} />
              </button>
              <span
                className="text-sm font-medium cursor-pointer select-none"
                onClick={() => set('is_graded', !form.is_graded)}
              >
                Graded card
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

            {/* ── Source + notes ────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Source"
                value={form.source}
                onChange={e => set('source', e.target.value)}
                options={SOURCES.map(s => ({ value: s, label: s }))}
                placeholder="Select source"
              />
            </div>

            <Textarea
              label="Notes"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Any additional info…"
              maxLength={500}
              showCharCount
            />

            {/* ── Footer ────────────────────────────────────────── */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" loading={updateCard.isPending}>
                Save changes
              </Button>
            </div>

          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
