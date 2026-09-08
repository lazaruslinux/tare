import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { Food, Headline, Panel } from '../api'
import { MICROS, microText, percentDv } from '../lib/micros'
import { UNIT_LABEL, amountText, scale } from '../lib/units'

// The panel, as it is stored and as it reads. The form fills in the same list,
// so the two can only ever ask for and show the same eleven numbers in the
// same order. Five of them are the ones anybody looks at; the rest are on the
// label when the label bothered.
export type Nutrient =
  | 'calories'
  | 'protein_g'
  | 'carbs_g'
  | 'fat_g'
  | 'saturated_fat_g'
  | 'trans_fat_g'
  | 'cholesterol_mg'
  | 'sodium_mg'
  | 'fiber_g'
  | 'sugar_g'
  | 'added_sugars_g'

export type Fact = { key: Nutrient; label: string; unit: string }

// Narrowed to the four, because these are also the four an entry carries and
// the four a day is totalled by. The Journal and the portion sheet read this
// one and nothing else.
export const HEADLINE: { key: Headline; label: string; unit: string }[] = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
]

// What a food says about itself at a glance: the four above and the sugar,
// which is the line worth seeing without asking for it.
export const QUICK_FACTS: Fact[] = [
  ...HEADLINE,
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
]

// The whole panel in the order a label prints it, indented where a label
// indents. Sugar is "Total sugars" here, because the line under it is the
// other half of the same answer.
export const LABEL_ORDER: (Fact & { sub?: boolean })[] = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
  { key: 'saturated_fat_g', label: 'Saturated fat', unit: 'g', sub: true },
  { key: 'trans_fat_g', label: 'Trans fat', unit: 'g', sub: true },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fiber_g', label: 'Fiber', unit: 'g', sub: true },
  { key: 'sugar_g', label: 'Total sugars', unit: 'g', sub: true },
  { key: 'added_sugars_g', label: 'Added sugars', unit: 'g', sub: true },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
]

// A number the label never gave. Not zero, and not left blank either: an empty
// cell reads as a number that failed to load.
const NOTHING = '-'

// A nutrient as it reads anywhere: a whole number. A tenth of a gram is noise
// on a plate, and a column of them is harder to read than the answer.
export function nutrientText(_key: Nutrient, value: number | null): string {
  if (value === null) return NOTHING
  return String(Math.round(value))
}

// The sugar tile says how much of it was put in, when that is known. A food
// nobody has read the added-sugars line off keeps the plain word.
function tileLabel(fact: Fact, values: Panel): string {
  if (fact.key !== 'sugar_g' || values.added_sugars_g === null) return fact.label
  return `Sugar (${nutrientText('added_sugars_g', values.added_sugars_g)} g added)`
}

// A heading that opens and closes what sits under it.
export function Fold({
  label,
  open = false,
  children,
}: {
  label: string
  open?: boolean
  children: ReactNode
}) {
  const [shown, setShown] = useState(open)
  return (
    <>
      <button
        type="button"
        className="t-micro mt-2 flex items-center gap-1"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 ${shown ? 'rotate-180' : ''}`} strokeWidth={2.5} />
      </button>
      {shown && <div className="mt-1">{children}</div>}
    </>
  )
}

// The figures themselves: the five anybody reads, the line saying what they
// are for, and the whole label behind a fold. Everything that shows a panel
// goes through this, so a food and a recipe are read the same way.
export function PanelFacts({
  values,
  note,
  // Where the screen above puts the note instead. The food page reads it on the
  // chips line once there is room, so its copy here is the narrow one.
  noteClass = '',
  // What the fold is called, whether it starts open, and anything that belongs
  // under it. A food puts its ingredients there; a recipe and a meal have none.
  moreLabel = 'More',
  open = false,
  children,
}: {
  values: Panel
  note?: string
  noteClass?: string
  moreLabel?: string
  open?: boolean
  children?: ReactNode
}) {

  return (
    <>
      {/* Natural width rather than four stretched columns, so the figures read
          as one group on a wide screen and still wrap on a phone. */}
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {QUICK_FACTS.map((fact) => (
          <div key={fact.key}>
            <span className="t-nums block text-xl font-semibold">
              {nutrientText(fact.key, values[fact.key])}
              {fact.unit && <span className="text-sm font-normal text-muted">{fact.unit}</span>}
            </span>
            <span className="block text-xs text-muted">{tileLabel(fact, values)}</span>
          </div>
        ))}
      </div>

      {note && <p className={`mt-2 text-xs text-muted ${noteClass}`}>{note}</p>}

      <Fold label={moreLabel} open={open}>
        {LABEL_ORDER.map((fact) => (
          <div key={fact.key} className="t-row min-h-9 text-sm">
            <span className={`flex-1 text-muted ${fact.sub ? 'pl-4' : ''}`}>{fact.label}</span>
            <span className="t-nums">
              {nutrientText(fact.key, values[fact.key])} {fact.unit}
            </span>
          </div>
        ))}
      </Fold>

      {children}
    </>
  )
}

// What the label is read per: the food's own first serving, or the 100 it is
// stored in when it has none. Exported because the vitamins fold beside it has
// to follow the same portion the figures above are showing.
export const labelBaseAmount = (food: Food): number =>
  food.servings[0] ? food.servings[0].base_amount : 100

// What a food has vitamins for at all. The fold is not drawn without one.
export const hasMicros = (food: Food): boolean =>
  MICROS.some((micro) => typeof food.micros?.[micro.key] === 'number')

// The vitamins and minerals, at the portion the label above is showing. Label
// order, only the rows something stated, and the percent of a day beside each.
// The stored per-100 figure is never drawn.
export function MicroRows({ food, baseAmount }: { food: Food; baseAmount: number }) {
  return (
    <>
      {MICROS.map((micro) => {
        const per100 = food.micros?.[micro.key]
        if (typeof per100 !== 'number') return null
        const amount = (per100 * baseAmount) / 100
        return (
          <div key={micro.key} className="t-row min-h-9 text-sm">
            <span className="flex-1 text-muted">{micro.label}</span>
            <span className="t-nums">
              {microText(amount)} {micro.unit}
            </span>
            <span className="t-nums w-16 shrink-0 text-right text-xs text-muted">
              {percentDv(micro, amount)}% DV
            </span>
          </div>
        )
      })}
    </>
  )
}

// A food's panel at some amount of it, which is what the figures above read.
function panelAt(food: Food, baseAmount: number): Panel {
  const values = {} as Panel
  for (const fact of LABEL_ORDER) {
    values[fact.key] = scale(food[fact.key], baseAmount)
  }
  return values
}

export function NutritionLabel({ food, children }: { food: Food; children?: ReactNode }) {
  const serving = food.servings[0]
  // One reading, and it is the serving. A food kept without a serving of its
  // own is read per the 100 it is stored in, said in the same words: what the
  // figures are per is a size, not a rule about storage.
  const baseAmount = labelBaseAmount(food)

  // Beside the chip, so the two read as one line: Per serving, 100 g.
  const size = serving
    ? `${serving.name}, ${amountText(serving.amount, serving.unit)} ${UNIT_LABEL[serving.unit]}`
    : `100 ${food.base_unit}`

  return (
    <div className="t-card mb-3 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 min-[640px]:flex-nowrap">
        <span className="t-chip">Per serving</span>
        <p className="t-nums hidden text-xs text-muted min-[640px]:ml-auto min-[640px]:block">
          {size}
        </p>
      </div>

      <PanelFacts
        values={panelAt(food, baseAmount)}
        note={size}
        noteClass="min-[640px]:hidden"
        moreLabel="Nutrition label"
        open
      >
        {children}
      </PanelFacts>
    </div>
  )
}
