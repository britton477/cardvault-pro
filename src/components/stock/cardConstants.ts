// =============================================================================
// Shared constants for card form modals (AddCardModal + EditCardModal)
// =============================================================================
import type { CardCondition } from '@/types'

export const CONDITIONS: { value: CardCondition; label: string }[] = [
  { value: 'NM',     label: 'NM — Near Mint' },
  { value: 'LP',     label: 'LP — Lightly Played' },
  { value: 'MP',     label: 'MP — Moderately Played' },
  { value: 'HP',     label: 'HP — Heavily Played' },
  { value: 'Sealed', label: 'Sealed' },
]

export const FOIL_TYPES = [
  'Normal', 'Reverse Holo', 'Holo', 'Full Art',
  'Secret Rare', 'Rainbow Rare', 'Gold Card', 'Alt Art', 'Other',
]

export const LANGUAGES = [
  { value: 'EN', label: 'English' },
  { value: 'JP', label: 'Japanese' },
  { value: 'DE', label: 'German' },
  { value: 'FR', label: 'French' },
  { value: 'IT', label: 'Italian' },
  { value: 'ES', label: 'Spanish' },
  { value: 'KO', label: 'Korean' },
  { value: 'PT', label: 'Portuguese' },
]

export const SOURCES = [
  'eBay', 'Local Shop', 'Card Show', 'Trade', 'Pack Pull', 'Collection', 'Other',
]

export const GRADERS = ['PSA', 'BGS', 'CGC', 'ACE', 'Other']
