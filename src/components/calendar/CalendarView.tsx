'use client'
// =============================================================================
// CalendarView — full monthly calendar grid
// =============================================================================
import { useState, useRef, useEffect }           from 'react'
import { ChevronLeft, ChevronRight, Plus, MapPin, Clock, Pencil, Trash2, X } from 'lucide-react'
import { useCalendarEvents, useDeleteEvent }      from '@/hooks/useCalendarEvents'
import { AddEventModal }                          from '@/components/calendar/AddEventModal'
import { useToast }                               from '@/components/ui/Toast'
import { cn }                                     from '@/lib/utils'
import {
  EVENT_TYPE_META, TYPE_LABEL, TYPE_EMOJI,
  COLOR_PILL, COLOR_DOT, COLOR_ACCENT,
  MONTH_NAMES, DAYS_OF_WEEK,
} from '@/components/calendar/calendarConstants'
import type { CalendarEvent } from '@/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getToday() {
  const d = new Date()
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

function toMonthStr(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function formatTime(time: string | null): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h! >= 12 ? 'pm' : 'am'
  const hour   = h! % 12 || 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''}${suffix}`
}

/** Build a 6-week grid (42 cells) starting on Monday */
function buildGrid(year: number, month: number): (number | null)[] {
  const firstDow    = new Date(year, month - 1, 1).getDay()   // 0=Sun
  const startOffset = (firstDow + 6) % 7                       // shift to Mon=0
  const daysInMonth = new Date(year, month, 0).getDate()

  const cells: (number | null)[] = Array(startOffset).fill(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length < 42) cells.push(null)
  return cells
}

/**
 * Group events by each date they cover.
 * FIX: parses date strings as LOCAL dates (not UTC) to avoid off-by-one
 * for users in UTC− timezones.
 */
function buildEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()

  for (const ev of events) {
    // Parse as local date to avoid UTC midnight → previous day in UTC− zones
    const [sy, sm, sd] = ev.event_date.split('-').map(Number)
    const [ey, em, ed] = (ev.end_date ?? ev.event_date).split('-').map(Number)

    const start = new Date(sy!, sm! - 1, sd!)
    const end   = new Date(ey!, em! - 1, ed!)
    const cur   = new Date(start)

    while (cur <= end) {
      const ds = toDateStr(cur.getFullYear(), cur.getMonth() + 1, cur.getDate())
      if (!map.has(ds)) map.set(ds, [])
      map.get(ds)!.push(ev)
      cur.setDate(cur.getDate() + 1)
    }
  }

  return map
}

// ── Event popover ─────────────────────────────────────────────────────────────

interface EventPopoverProps {
  event:    CalendarEvent
  onClose:  () => void
  onEdit:   (ev: CalendarEvent) => void
  onDelete: (id: string) => void
  deleting: boolean
}

function EventPopover({ event, onClose, onEdit, onDelete, deleting }: EventPopoverProps) {
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  return (
    <div
      ref={ref}
      className={cn(
        'absolute z-30 left-0 top-full mt-1 w-72 rounded-lg border border-border bg-card shadow-xl border-l-4',
        COLOR_ACCENT[event.color],
      )}
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-sm">{TYPE_EMOJI[event.event_type]}</span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
              {TYPE_LABEL[event.event_type]}
            </span>
          </div>
          <p className="text-sm font-semibold leading-tight break-words">{event.title}</p>
        </div>
        <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors flex-shrink-0">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Details */}
      <div className="px-4 pb-3 space-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span>📅</span>
          <span>
            {event.event_date}
            {event.end_date && event.end_date !== event.event_date && ` → ${event.end_date}`}
          </span>
        </div>
        {!event.all_day && event.start_time && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            <span>{formatTime(event.start_time)}{event.end_time && ` – ${formatTime(event.end_time)}`}</span>
          </div>
        )}
        {event.location && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            <span className="break-words">{event.location}</span>
          </div>
        )}
        {event.description && (
          <p className="pt-1 text-foreground/70 whitespace-pre-wrap">{event.description}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-t border-border">
        {confirming ? (
          <>
            <span className="text-xs text-destructive flex-1">Delete this event?</span>
            <button onClick={() => onDelete(event.id)} disabled={deleting}
              className="rounded px-2 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50">
              {deleting ? '…' : 'Yes'}
            </button>
            <button onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-xs border border-border text-muted-foreground hover:bg-secondary transition-colors">
              No
            </button>
          </>
        ) : (
          <>
            <button onClick={() => onEdit(event)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary border border-border transition-colors">
              <Pencil className="h-3 w-3" /> Edit
            </button>
            <button onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-destructive/10 border border-destructive/30 transition-colors">
              <Trash2 className="h-3 w-3" /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Day cell ──────────────────────────────────────────────────────────────────

const MAX_PILLS = 3

interface DayCellProps {
  day:           number | null
  dateStr:       string
  isToday:       boolean
  events:        CalendarEvent[]
  onDayClick:    (dateStr: string) => void
  onEventClick:  (ev: CalendarEvent, dateStr: string) => void
  activePopover: { eventId: string; dateStr: string } | null
  onPopoverClose: () => void
  onEdit:        (ev: CalendarEvent) => void
  onDelete:      (id: string) => void
  deleting:      boolean
}

function DayCell({ day, dateStr, isToday, events, onDayClick, onEventClick, activePopover, onPopoverClose, onEdit, onDelete, deleting }: DayCellProps) {
  const visible  = events.slice(0, MAX_PILLS)
  const overflow = events.length - MAX_PILLS

  if (day === null) {
    return <div className="min-h-[100px] border-r border-b border-border/50 bg-secondary/10" />
  }

  return (
    <div
      className="min-h-[100px] border-r border-b border-border/50 p-1.5 relative transition-colors cursor-pointer group hover:bg-secondary/20"
      onClick={() => onDayClick(dateStr)}
    >
      {/* Day number + quick-add */}
      <div className="flex items-center justify-between mb-1">
        <span className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
          isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
        )}>
          {day}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onDayClick(dateStr) }}
          className="invisible group-hover:visible rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label={`Add event on ${dateStr}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {/* Event pills */}
      <div className="space-y-0.5">
        {visible.map(ev => {
          const isActive = activePopover?.eventId === ev.id && activePopover?.dateStr === dateStr
          return (
            <div key={ev.id} className="relative">
              <button
                onClick={e => { e.stopPropagation(); onEventClick(ev, dateStr) }}
                title={ev.title}
                className={cn(
                  'w-full text-left rounded px-1.5 py-0.5 text-[10px] font-medium border truncate transition-opacity hover:opacity-80',
                  COLOR_PILL[ev.color],
                  isActive && 'ring-1 ring-ring',
                )}
              >
                <span className="mr-0.5">{TYPE_EMOJI[ev.event_type]}</span>
                {!ev.all_day && ev.start_time && (
                  <span className="opacity-70 mr-0.5">{formatTime(ev.start_time)}</span>
                )}
                {ev.title}
              </button>
              {isActive && (
                <EventPopover event={ev} onClose={onPopoverClose} onEdit={onEdit} onDelete={onDelete} deleting={deleting} />
              )}
            </div>
          )
        })}
        {overflow > 0 && (
          <button
            onClick={e => { e.stopPropagation(); onDayClick(dateStr) }}
            className="w-full text-left px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            +{overflow} more
          </button>
        )}
      </div>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function CalendarLegend() {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {EVENT_TYPE_META.map(t => (
        <div key={t.value} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <div className={cn('h-2 w-2 rounded-full', COLOR_DOT[t.color])} />
          <span>{t.emoji} {t.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function CalendarView() {
  const init = getToday()
  const [year,  setYear]  = useState(init.year)
  const [month, setMonth] = useState(init.month)

  const monthStr = toMonthStr(year, month)

  const { data: events = [], isLoading } = useCalendarEvents(monthStr)
  const deleteEvent = useDeleteEvent(monthStr)
  const { toast }   = useToast()

  const [showModal,    setShowModal]    = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [activePopover, setActivePopover] = useState<{ eventId: string; dateStr: string } | null>(null)

  // Navigation — avoid two useState updates causing double render
  function prevMonth() { setMonth(m => { if (m === 1) { setYear(y => y - 1); return 12 } return m - 1 }) }
  function nextMonth() { setMonth(m => { if (m === 12) { setYear(y => y + 1); return 1  } return m + 1 }) }
  function goToToday() { const t = getToday(); setYear(t.year); setMonth(t.month) }

  function openCreate(dateStr: string) {
    setSelectedDate(dateStr)
    setEditingEvent(null)
    setShowModal(true)
    setActivePopover(null)
  }
  function openEdit(ev: CalendarEvent) {
    setEditingEvent(ev)
    setSelectedDate(undefined)
    setShowModal(true)
    setActivePopover(null)
  }
  function togglePopover(ev: CalendarEvent, dateStr: string) {
    setActivePopover(prev =>
      prev?.eventId === ev.id && prev?.dateStr === dateStr ? null : { eventId: ev.id, dateStr }
    )
  }

  async function handleDelete(id: string) {
    try {
      await deleteEvent.mutateAsync(id)
      toast.success('Event deleted')
      setActivePopover(null)
    } catch (err) {
      toast.error('Failed to delete event', err instanceof Error ? err.message : undefined)
    }
  }

  // FIX: compute today fresh so stale closure doesn't affect highlighting after midnight
  const t          = getToday()
  const todayStr   = toMonthStr(t.year, t.month) === monthStr ? toDateStr(t.year, t.month, t.day) : ''
  const cells      = buildGrid(year, month)
  const byDate     = buildEventsByDate(events)

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Calendar</h1>
          {isLoading && <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToToday} className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-sm font-medium hover:bg-secondary transition-colors">
            Today
          </button>
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button onClick={prevMonth} className="px-2.5 py-1.5 hover:bg-secondary transition-colors" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 py-1.5 text-sm font-semibold min-w-[140px] text-center border-x border-border">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <button onClick={nextMonth} className="px-2.5 py-1.5 hover:bg-secondary transition-colors" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {/* FIX: use current month's first day when not on today's month */}
          <button
            onClick={() => openCreate(toMonthStr(t.year, t.month) === monthStr ? toDateStr(t.year, t.month, t.day) : toDateStr(year, month, 1))}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New event
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-border bg-secondary/30">
          {DAYS_OF_WEEK.map(d => (
            <div key={d} className="py-2 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const dateStr = day !== null ? toDateStr(year, month, day) : `empty-${i}`
            return (
              <DayCell
                key={dateStr}
                day={day}
                dateStr={dateStr}
                isToday={dateStr === todayStr}
                events={day !== null ? (byDate.get(dateStr) ?? []) : []}
                onDayClick={openCreate}
                onEventClick={togglePopover}
                activePopover={activePopover}
                onPopoverClose={() => setActivePopover(null)}
                onEdit={openEdit}
                onDelete={(id) => { void handleDelete(id) }}
                deleting={deleteEvent.isPending}
              />
            )
          })}
        </div>
      </div>

      {/* Legend + count */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <CalendarLegend />
        {events.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {events.length} event{events.length !== 1 ? 's' : ''} this month
          </p>
        )}
      </div>

      <AddEventModal
        open={showModal}
        onClose={() => { setShowModal(false); setEditingEvent(null) }}
        month={monthStr}
        initialDate={selectedDate}
        event={editingEvent}
      />
    </div>
  )
}
