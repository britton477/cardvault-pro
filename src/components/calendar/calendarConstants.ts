// =============================================================================
// Shared calendar constants — single source of truth for both CalendarView
// and AddEventModal. Import from here, never redefine inline.
// =============================================================================
import type { CalendarEventType, CalendarEventColor } from '@/types'

export const EVENT_TYPE_META: {
  value:   CalendarEventType
  label:   string
  emoji:   string
  color:   CalendarEventColor
}[] = [
  { value: 'show',           label: 'Card Show',   emoji: '🎪', color: 'purple' },
  { value: 'reminder',       label: 'Reminder',    emoji: '🔔', color: 'blue'   },
  { value: 'restock',        label: 'Restock',     emoji: '📦', color: 'green'  },
  { value: 'follow_up',      label: 'Follow-up',   emoji: '📋', color: 'amber'  },
  { value: 'social_post',    label: 'Social Post', emoji: '📱', color: 'red'    },
  { value: 'collection_buy', label: 'Collection',  emoji: '🛒', color: 'green'  },
  { value: 'other',          label: 'Other',       emoji: '📌', color: 'gray'   },
]

// Derived lookup maps — O(1) access in render
export const TYPE_LABEL   = Object.fromEntries(EVENT_TYPE_META.map(t => [t.value, t.label]))   as Record<CalendarEventType, string>
export const TYPE_EMOJI   = Object.fromEntries(EVENT_TYPE_META.map(t => [t.value, t.emoji]))   as Record<CalendarEventType, string>
export const TYPE_COLOR   = Object.fromEntries(EVENT_TYPE_META.map(t => [t.value, t.color]))   as Record<CalendarEventType, CalendarEventColor>

export const COLOR_OPTIONS: { value: CalendarEventColor; label: string; tw: string }[] = [
  { value: 'blue',   label: 'Blue',   tw: 'bg-blue-500'   },
  { value: 'green',  label: 'Green',  tw: 'bg-green-500'  },
  { value: 'amber',  label: 'Amber',  tw: 'bg-amber-500'  },
  { value: 'red',    label: 'Red',    tw: 'bg-red-500'    },
  { value: 'purple', label: 'Purple', tw: 'bg-purple-500' },
  { value: 'gray',   label: 'Gray',   tw: 'bg-gray-500'   },
]

export const COLOR_PILL: Record<CalendarEventColor, string> = {
  blue:   'bg-blue-500/20   text-blue-300   border-blue-500/40',
  green:  'bg-green-500/20  text-green-300  border-green-500/40',
  amber:  'bg-amber-500/20  text-amber-300  border-amber-500/40',
  red:    'bg-red-500/20    text-red-300    border-red-500/40',
  purple: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  gray:   'bg-gray-500/20   text-gray-300   border-gray-500/40',
}

export const COLOR_DOT: Record<CalendarEventColor, string> = {
  blue:   'bg-blue-500',
  green:  'bg-green-500',
  amber:  'bg-amber-500',
  red:    'bg-red-500',
  purple: 'bg-purple-500',
  gray:   'bg-gray-500',
}

export const COLOR_ACCENT: Record<CalendarEventColor, string> = {
  blue:   'border-l-blue-500',
  green:  'border-l-green-500',
  amber:  'border-l-amber-500',
  red:    'border-l-red-500',
  purple: 'border-l-purple-500',
  gray:   'border-l-gray-500',
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
