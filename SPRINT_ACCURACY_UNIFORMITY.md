# Sprint: Classification Accuracy, Bulk Upload & Editing Uniformity

**Duration:** 2 weeks (10 working days)
**Theme:** Fix what's wrong (rarity misclassification, missing net-proceeds), simplify what's clunky (bulk upload), and make editable fields behave the same everywhere.
**Stack touched:** Next.js 14 App Router, Supabase (Postgres), React Query, Zustand, TanStack Table, Anthropic vision, eBay API.

---

## 1. Problem statement (grounded in the current code)

| # | Symptom you reported | Root cause found in code |
|---|---|---|
| 1 | Card types misclassified; sub-types off; **standard ex Double Rares tagged as SIR** | `api/bulk-wizard/identify` sets `foil_type` **purely from the vision model's guess**. The authoritative `rarity` the TCG API already returns (`api/tcg/search` selects `rarity`) is **never used**. `BulkWizardCard` has **no rarity field** — `foil_type` is overloaded as both type and sub-type, and the prompt's enum biases the model toward SIR. |
| 2 | Bulk upload needs more config; all variables should be adjustable | Defaults (markup, condition, source, pricing strategy) are hardcoded across `pricing.ts` / wizard; only a subset is overridable per card, none configurable per batch. |
| 3 | Front/back should auto-assign from two photos | Today's flow is a **manual "batch backs" mode** (`BulkWizardView.tsx`) that assigns backs in upload order — no automatic pairing on first upload. |
| 4 | List→eBay: show what I *receive* after buyer protection, excluding postage | `lib/fees.ts` already computes `calcBuyerFee`/`calcBuyerTotal`, but `SetListingSlideOver` shows **only the list price** — no net box. No seller-model switch (private vs business). |
| 5 | No graded support in the wizard | Stock `Card` has `is_graded/grader/grade`; **`BulkWizardCard` does not**. |
| 6 | Wizard eBay price should be editable, and it's throwing off purchase price | `CardScanRow` only *refreshes* `ebay_avg_sold` (no manual override). Purchase price is allocated from lot cost proportionally to eBay value, so a wrong eBay figure corrupts the cost split. |
| 7 | Make editing uniform — editable in one place, editable everywhere sensible | Inline edit primitives (`InlineEdit`/`InlineSelect`) live privately inside `CardScanRow`; stock uses modal forms; eBay slide-over is read-only. No shared editing component. |

**Decisions locked (from you):** net-proceeds calc supports **both private & business** seller models (configurable); front/back uses **strict pair order** (+ a pairing preview as the safety guard); rarity uses **TCG API primary, vision fallback**.

---

## 2. Architecture: three shared foundations first

Everything else reuses these, so they land on Day 1–3. This is the same "single source of truth" discipline already applied in `fees.ts` and `pricing.ts` — don't add a fourth competing definition, extend the canonical one.

### 2.1 `src/lib/rarity.ts` — canonical rarity (NEW)
One module that owns the Bulbapedia taxonomy and all normalisation. No screen invents its own mapping.

```ts
// Canonical modern (SV-era) taxonomy, aligned to Bulbapedia "Rarity"
export type Rarity =
  | 'Common' | 'Uncommon' | 'Rare'
  | 'Double Rare'              // the ex cards (RR, ★★) — NOT SIR
  | 'Ultra Rare'              // full-art ex / V / VMAX etc.
  | 'Illustration Rare'       // AR
  | 'Special Illustration Rare' // SIR — special/alt art, number ABOVE set total
  | 'Hyper Rare'              // gold
  | 'Shiny Rare' | 'Radiant Rare' | 'ACE SPEC Rare' | 'Promo' | 'Unknown'

// Normalise any TCG-API rarity string into the canonical enum.
export function normaliseRarity(apiRarity: string | null): Rarity
// Foil pattern (Holo / Reverse / Normal) is SEPARATE from rarity — keep both.
export function foilFromRarity(r: Rarity, visionFoil: string): FoilPattern
```

**The SIR fix:** a card is only `Special Illustration Rare` when the API says so (or, in fallback, when the model sees alt/extended art **and** the card number is above the set total). A plain `ex` inside the set numbering is `Double Rare`. This kills the over-firing at the root rather than re-tuning a guess.

### 2.2 `src/components/shared/InlineField.tsx` — one editable primitive (EXTRACT)
Promote the existing `InlineEdit`/`InlineSelect` out of `CardScanRow` into a shared component (text | number | select | currency variants, optimistic save, escape-to-cancel, a11y labels). Every screen that edits a value uses this — that is the uniformity mechanism, not a copy-paste.

### 2.3 `src/lib/fees.ts` — seller-model-aware net proceeds (EXTEND)
Keep the existing bracket maths. Add:

```ts
export type SellerModel =
  | { kind: 'private' }                              // buyer pays protection on top
  | { kind: 'business'; fvfPct: number; fvfFixed: number } // you pay FVF on the sale

// What YOU receive for a given list price, excluding postage.
export function calcNetProceeds(listPrice: number, model: SellerModel): {
  buyerPaysExclPostage: number   // list + buyer protection (info)
  youReceive: number             // private ≈ list; business = list − FVF
  feeShown: number
}
```

Private: `youReceive ≈ listPrice`, and we surface `buyerPaysExclPostage = list + calcBuyerFee`. Business: `youReceive = listPrice − (listPrice*fvfPct + fvfFixed)`. Model + business params live in `org_settings`.

---

## 3. Workstreams & tasks

### WS0 — Foundations (Day 1–3) — *blocks everything*
- [ ] Migration: add `rarity text` to `cards`; add `seller_model`, `fvf_pct`, `fvf_fixed`, and batch-default columns to `org_settings`.
- [ ] Build `lib/rarity.ts` + unit tests (Double Rare vs SIR is the headline case).
- [ ] Extend `lib/fees.ts` with `SellerModel` + `calcNetProceeds` + tests (private and business).
- [ ] Extract `components/shared/InlineField.tsx` from `CardScanRow`; refactor `CardScanRow` to consume it (no behaviour change — pure refactor, proves the primitive).
- [ ] Add `rarity`, `is_graded`, `grader`, `grade` to `BulkWizardCard` type + import payload.

### WS1 — Classification accuracy (Day 3–5)
- [ ] Extend `api/tcg/search` (or add `api/tcg/lookup`) for **exact** match by `set_code` + `card_number` returning `rarity` + `supertype`.
- [ ] In the identify pipeline: after set/number are known, look up authoritative rarity; set `rarity` from it, `foil_type` from `foilFromRarity`. Vision result becomes fallback only.
- [ ] Slim the vision prompt: output a *separate* conservative `rarity` guess (used only on lookup miss); stop letting `foil_type` carry rarity. Removes the SIR bias.
- [ ] Cache lookups by `set_code|card_number` via existing `lib/cache.ts`; fold into the wizard's existing `MAX_CONCURRENT=3` pool so a 112-card batch adds no extra latency wall.
- [ ] Show rarity + foil as two distinct, inline-editable fields on the scan row (user can still override).

### WS2 — Bulk upload: simpler + configurable + graded (Day 4–7)
- [ ] **Strict pair-order front/back:** chunk uploaded images 2-by-2 → `[front, back]`. Replaces the manual batch-backs step for the common case.
- [ ] **Pairing preview grid** (the guard strict mode needs): show each pair as front|back thumbnails before commit; drag to re-pair or mark a card single-sided, so one stray photo can't silently desync the rest. `// ponytail: strict chunk + visible preview; add vision back-detection only if pairing errors become common`.
- [ ] **Batch defaults panel:** every hardcoded default becomes adjustable per batch *and* persisted to `org_settings` — pricing strategy + markup/adjustment %, default condition, default source, language, rarity-source toggle, pairing mode. Per-card overrides already exist and win over batch defaults.
- [ ] **Graded input** on the scan row: `Graded` checkbox → reveals grader select (`GRADERS` already defined) + grade. Flows straight into the existing `Card` graded fields. Graded cards skip condition (grade replaces it).

### WS3 — Editable eBay price → correct purchase price (Day 6–8)
- [ ] Make `ebay_avg_sold` directly editable on the scan row via `InlineField` (currency), not just refresh; mark manually-set values so a later refresh doesn't clobber them.
- [ ] When the eBay price is edited and the batch is lot-costed, **re-run the proportional cost allocation** across the batch so `purchase_price` self-corrects. Show the recomputed cost inline (reuse `CostBreakdownTable`).
- [ ] Guard: allocation re-runs are debounced and pure (`toPence`), so editing one card doesn't thrash the whole grid.

### WS4 — List→eBay net proceeds (Day 7–9)
- [ ] Settings UI: seller model toggle (Private / Business) + business FVF % and fixed fee.
- [ ] Net box beside every list-price input: live `youReceive` (bold) + `buyer pays (excl. postage)` (muted). Screens: `SetListingSlideOver`, single-listing modal, and the wizard's list-price field.
- [ ] Profit/cost tracking (`calcProfit`, reports) reads `youReceive` so margins reflect real receipts, not gross list.

### WS5 — Uniformity pass (Day 9–10)
- [ ] Roll `InlineField` into the stock TanStack table and eBay slide-over: price, condition, foil, **rarity**, eBay price all editable in place — same component, same optimistic-save UX everywhere.
- [ ] Net-proceeds box appears anywhere a price is set (stock, sales, wizard, eBay).
- [ ] Rarity displayed and editable wherever foil_type is shown today.

---

## 4. Senior-dev cross-cutting (perf, robustness, scale)

- **Money:** integer pence end-to-end (`toPence` already), never float-carried. All fee/allocation maths gets a runnable assert self-check.
- **Rendering big batches:** `React.memo` `CardScanRow` keyed by `uid`; virtualise the stock table (TanStack) so 100+ rows don't re-render on a single-field edit. Optimistic inline saves keep typing latency off the network.
- **Vision/lookup throughput:** rarity lookup joins the existing concurrency-3 pool and is cached — no added wall-clock on large imports; the vision call stays the bottleneck, unchanged.
- **Trust boundaries:** keep Zod validation on all API inputs; new fields (`rarity`, graded, seller-model, FVF) validated server-side. Never trust client-computed proceeds — recompute on save.
- **Migrations:** additive, nullable columns; backfill `rarity` for existing cards in a background script via the same TCG lookup.
- **No new deps** — everything above uses what's installed (Radix, TanStack, Zod, React Query).

---

## 5. Definition of done
- A standard `ex` imports as **Double Rare**, its alt-art as **SIR** — verified on a real ~100-card batch.
- Two photos per card auto-pair front/back; a deliberately misordered upload is caught in the preview.
- Every batch default is adjustable and persists; graded cards import with grader + grade.
- eBay price is editable in the wizard and corrects purchase price on lot-costed batches.
- Typing list price `30` shows net receipts live, correct for both private and business.
- Price / condition / foil / rarity / eBay price edit identically (same component) on wizard, stock, and eBay screens.

## 6. Risks & mitigations
- **TCG API gaps** (card not in dataset) → vision fallback + inline override; log misses to tighten later.
- **Strict pairing desync** → the preview grid is the mitigation; vision back-detection is the pre-scoped upgrade path if error rates warrant it.
- **eBay fee schedules change** → all rates live in `fees.ts` / `org_settings`, never scattered.

## 7. Suggested sequencing
Week 1: WS0 → WS1 → start WS2 (graded + config).
Week 2: finish WS2 (pairing) → WS3 → WS4 → WS5 + QA on a real batch.
