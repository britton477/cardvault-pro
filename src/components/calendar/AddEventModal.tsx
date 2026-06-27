'use client'
// =============================================================================
// AddEventModal — create or edit a calendar event
// =============================================================================
import { useState, useEffect }                         from 'react'
import { X, Calendar, Clock, MapPin, AlignLeft, Tag }  from 'lucide-react'
import { useCreateEvent, useUpdateEvent }               from '@/hooks/useCalendarEvents'
import { useToast }                                     from '@/components/ui/Toast'
import { cn }                                           from '@/lib/utils'
import { EVENT_TYPE_META, TYPE_COLOR, COLOR_OPTIONS }   from '@/components/calendar/calendarConstants'
import type { CalendarEvent, CalendarEventType, CalendarEventColor, CreateEventInput } from '@/types'

// ── Form helpers ──────────────────────────────────────────────────────────────

interface FormState {
  title:       string
  description: string
  event_type:  CalendarEventType
  event_date:  string
  end_date:    string
  all_day:     boolean
  start_time:  string
  end_time:    string
  location:    string
  color:       CalendarEventColor
}

function defaultForm(initialDate?: string, event?: CalendarEvent): FormState {
  if (event) {
    return {
      title:       event.title,
      description: event.description,
      event_type:  event.event_type,
      event_date:  event.event_date,
      end_date:    event.end_date   ?? '',
      all_day:     event.all_day,
      start_time:  event.start_time ?? '',
      end_time:    event.end_time   ?? '',
      location:    event.location,
      color:       event.color,
    }
  }
  return {
    title:       '',
    description: '',
    event_type:  'reminder',
    event_date:  initialDate ?? new Date().toISOString().split('T')[0]!,
    end_date:    '',
    all_day:     true,
    start_time:  '',
    end_time:    '',
    location:    '',
    color:       TYPE_COLOR['reminder'],
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface AddEventModalProps {
  open:         boolean
  onClose:      () => void
  month:        string
  initialDate?: string
  event?:       CalendarEvent | null
}

export function AddEventModal({ open, onClose, month, initialDate, event }: AddEventModalProps) {
  const isEdit    = Boolean(event)
  const create    = useCreateEvent(month)
  const update    = useUpdateEvent(month)
  const { toast } = useToast()
  const isPending = create.isPending || update.isPending

  const [form, setForm] = useState<FormState>(() => defaultForm(initialDate, event ?? undefined))

  useEffect(() => {
    if (open) setForm(defaultForm(initialDate, event ?? undefined))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event?.id, initialDate])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function handleTypeChange(type: CalendarEventType) {
    setForm(prev => ({
      ...prev,
      event_type: type,
      // Auto-switch colour only if it's still the default for the previous type
      color: prev.color === TYPE_COLOR[prev.event_type] ? TYPE_COLOR[type] : prev.color,
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return

    const payload: CreateEventInput = {
      title:       form.title.trim(),
      description: form.description.trim(),
      event_type:  form.event_type,
      event_date:  form.event_date,
      end_date:    form.end_date   || null,
      all_day:     form.all_day,
      start_time:  form.all_day ? null : (form.start_time || null),
      end_time:    form.all_day ? null : (form.end_time   || null),
      location:    form.location.trim(),
      color:       form.color,
    }

    try {
      if (isEdit && event) {
        await update.mutateAsync({ id: event.id, ...payload })
        toast.success('Event updated', form.title)
      } else {
        await create.mutateAsync(payload)
        toast.success('Event created', form.title)
      }
      onClose()
    } catch (err) {
      toast.error(isEdit ? 'Failed to update event' : 'Failed to create event', err instanceof Error ? err.message : undefined)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-border">
          <h2 className="font-semibold text-base">{isEdit ? 'Edit event' : 'New event'}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e) }} className="p-6 space-y-4">

          {/* Title */}
          <input
            type="text"
            placeholder="Event title *"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            required
            autoFocus
            className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          {/* Event type — 4-col grid for balanced 2-row layout with 7 types */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              <Tag className="h-3 w-3 inline mr-1" />Type
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {EVENT_TYPE_META.map(t => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => handleTypeChange(t.value)}
                  className={cn(
                    'flex flex-col items-center gap-0.5 rounded-md border py-2 text-xs transition-colors',
                    form.event_type === t.value
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <span className="text-base">{t.emoji}</span>
                  <span className="leading-tight text-center">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                <Calendar className="h-3 w-3 inline mr-1" />Date *
              </label>
              <input
                type="date"
                value={form.event_date}
                onChange={e => set('event_date', e.target.value)}
                required
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                End date <span className="opacity-50">(optional)</span>
              </label>
              <input
                type="date"
                value={form.end_date}
                min={form.event_date}
                onChange={e => set('end_date', e.target.value)}
                className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* All-day toggle + optional times */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => set('all_day', !form.all_day)}
              className="flex items-center gap-2 select-none"
            >
              <div className={cn('h-5 w-9 rounded-full transition-colors relative', form.all_day ? 'bg-primary' : 'bg-border')}>
                <div className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', form.all_day ? 'translate-x-4' : 'translate-x-0.5')} />
              </div>
              <span className="text-sm text-muted-foreground">All day</span>
            </button>

            {!form.all_day && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    <Clock className="h-3 w-3 inline mr-1" />Start time
                  </label>
                  <input type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">End time</label>
                  <input type="time" value={form.end_time} min={form.start_time} onChange={e => set('end_time', e.target.value)}
                    className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              <MapPin className="h-3 w-3 inline mr-1" />Location <span className="opacity-50">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Venue, address, or URL"
              value={form.location}
              onChange={e => set('location', e.target.value)}
              className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              <AlignLeft className="h-3 w-3 inline mr-1" />Notes <span className="opacity-50">(optional)</span>
            </label>
            <textarea
              placeholder="Add notes…"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Colour */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Colour</label>
            <div className="flex items-center gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => set('color', c.value)}
                  title={c.label}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform',
                    c.tw,
                    form.color === c.value
                      ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground scale-110'
                      : 'hover:scale-110',
                  )}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button type="button" onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isPending || !form.title.trim()}
              className="rounded-md px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {isPending
                ? (isEdit ? 'Saving…'       : 'Creating…')
                : (isEdit ? 'Save changes'  : 'Create event')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
