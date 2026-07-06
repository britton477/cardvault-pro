// =============================================================================
// Pokémon TCG set code → full set name lookup
//
// Used in the Bulk Wizard to display a human-readable set name instead of
// the short code (e.g. "Lost Origin" instead of "LOR").
//
// Source: Pokémon TCG API set list + Limitless TCG codes.
// Format: UPPERCASE set code → display name
// =============================================================================

export const POKEMON_SET_NAMES: Record<string, string> = {
  // ── Scarlet & Violet era ────────────────────────────────────────────────────
  SV1:   'Scarlet & Violet',
  SV2:   'Paldea Evolved',
  SV3:   'Obsidian Flames',
  SV3PT5: 'Pokémon 151',
  SV4:   'Paradox Rift',
  SV4PT5: 'Paldean Fates',
  SV5:   'Temporal Forces',
  SV6:   'Twilight Masquerade',
  SV6PT5: 'Shrouded Fable',
  SV7:   'Stellar Crown',
  SV7PT5: 'Surging Sparks',
  SV8:   'Prismatic Evolutions',
  SV8PT5: 'Destined Rivals',
  SV9:   'Journey Together',

  // ── Sword & Shield era ──────────────────────────────────────────────────────
  SSH:   'Sword & Shield',
  RCL:   'Rebel Clash',
  DAA:   'Darkness Ablaze',
  CPA:   'Champion\'s Path',
  VIV:   'Vivid Voltage',
  SHF:   'Shining Fates',
  BST:   'Battle Styles',
  CRE:   'Chilling Reign',
  EVS:   'Evolving Skies',
  CEL25: 'Celebrations',
  FST:   'Fusion Strike',
  BRS:   'Brilliant Stars',
  ASR:   'Astral Radiance',
  PGO:   'Pokémon GO',
  LOR:   'Lost Origin',
  SIT:   'Silver Tempest',
  CRZ:   'Crown Zenith',

  // ── Sun & Moon era ──────────────────────────────────────────────────────────
  SUM:   'Sun & Moon',
  GRI:   'Guardians Rising',
  BUS:   'Burning Shadows',
  SLG:   'Shining Legends',
  CIN:   'Crimson Invasion',
  UPR:   'Ultra Prism',
  FLI:   'Forbidden Light',
  CES:   'Celestial Storm',
  DRM:   'Dragon Majesty',
  LOT:   'Lost Thunder',
  TEU:   'Team Up',
  DET:   'Detective Pikachu',
  UNB:   'Unbroken Bonds',
  UNM:   'Unified Minds',
  HIF:   'Hidden Fates',
  CEC:   'Cosmic Eclipse',

  // ── XY era ──────────────────────────────────────────────────────────────────
  XY:    'XY',
  FLF:   'Flashfire',
  FFI:   'Furious Fists',
  PHF:   'Phantom Forces',
  PRC:   'Primal Clash',
  DCR:   'Double Crisis',
  ROS:   'Roaring Skies',
  AOR:   'Ancient Origins',
  BKT:   'BREAKthrough',
  BKP:   'BREAKpoint',
  GEN:   'Generations',
  FCO:   'Fates Collide',
  STS:   'Steam Siege',
  EVO:   'Evolutions',

  // ── Black & White era ───────────────────────────────────────────────────────
  BLW:   'Black & White',
  EPO:   'Emerging Powers',
  NXD:   'Next Destinies',
  DEX:   'Dark Explorers',
  DRX:   'Dragons Exalted',
  BCR:   'Boundaries Crossed',
  PLS:   'Plasma Storm',
  PLF:   'Plasma Freeze',
  PLB:   'Plasma Blast',
  LTR:   'Legendary Treasures',
  KSS:   'Kalos Starter Set',

  // ── HeartGold SoulSilver era ─────────────────────────────────────────────────
  HGSS:  'HeartGold & SoulSilver',
  UL:    'Unleashed',
  UD:    'Undaunted',
  TM:    'Triumphant',
  CL:    'Call of Legends',

  // ── Diamond & Pearl era ──────────────────────────────────────────────────────
  DP:    'Diamond & Pearl',
  MT:    'Mysterious Treasures',
  SW:    'Secret Wonders',
  GE:    'Great Encounters',
  MD:    'Majestic Dawn',
  LA:    'Legends Awakened',
  SF:    'Stormfront',

  // ── Promos ───────────────────────────────────────────────────────────────────
  SVP:   'SV Black Star Promos',
  SWSHP: 'SWSH Black Star Promos',
  SUMP:  'SM Black Star Promos',
  XYP:   'XY Black Star Promos',

  // ── Japanese sets (common in UK market) ──────────────────────────────────────
  'SV2A': 'Pokémon Card 151 (JPN)',
  'SV1A': 'Triplet Beat (JPN)',
  'SV1S': 'Scarlet ex (JPN)',
  'SV1V': 'Violet ex (JPN)',
}

/**
 * Returns the full set name for a given set code.
 * Falls back to the original code if no mapping exists.
 */
export function getSetName(setCode: string | null | undefined): string {
  if (!setCode) return ''
  const upper = setCode.toUpperCase().trim()
  return POKEMON_SET_NAMES[upper] ?? setCode
}
