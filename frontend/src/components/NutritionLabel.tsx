import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import type { Food, Headline, Panel } from '../api'
import { UNIT_LABEL, round1, scale } from '../lib/units'

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

// A nutrient as it reads anywhere: a whole number for calories, because a tenth
// of one is noise, and a tenth for everything else.
export function nutrientText(key: Nutrient, value: number | null): string {
  if (value === null) return NOTHING
  return String(key === 'calories' ? Math.round(value) : round1(value))
}

// The sugar tile says how much of it was put in, when that is known. A food
// nobody has read the added-sugars line off keeps the plain word.
function tileLabel(fact: Fact, values: Panel): string {
  if (fact.key !== 'sugar_g' || values.added_sugars_g === null) return fact.label
  return `Sugar (${nutrientText('added_sugars_g', values.added_sugars_g)}g added)`
}

// The figures themselves: the five anybody reads, the line saying what they
// are for, and the whole label behind "More". Everything that shows a panel
// goes through this, so a food and a recipe are read the same way.
export function PanelFacts({
  values,
  note,
  // Where the screen above puts the note instead. The food page reads it on the
  // chips line once there is room, so its copy here is the narrow one.
  noteClass = '',
}: {
  values: Panel
  note: string
  noteClass?: string
}) {
  const [more, setMore] = useState(false)

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

      <p className={`mt-2 text-xs text-muted ${noteClass}`}>{note}</p>

      <button
        type="button"
        className="t-micro mt-2 flex items-center gap-1"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        More
        <ChevronDown className={`h-3.5 w-3.5 ${more ? 'rotate-180' : ''}`} strokeWidth={2.5} />
      </button>

      {more && (
        <div className="mt-1">
          {LABEL_ORDER.map((fact) => (
            <div key={fact.key} className="t-row min-h-9 text-sm">
              <span className={`flex-1 text-muted ${fact.sub ? 'pl-4' : ''}`}>{fact.label}</span>
              <span className="t-nums">
                {nutrientText(fact.key, values[fact.key])} {fact.unit}
              </span>
            </div>
          ))}
        </div>
      )}
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

export function NutritionLabel({ food }: { food: Food }) {
  const serving = food.servings[0]
  // One reading, and it is the serving. A food kept without a serving of its
  // own is read per the 100 it is stored in, said in the same words: what the
  // figures are per is a size, not a rule about storage.
  const baseAmount = serving ? serving.base_amount : 100

  // Beside the chip, so the two read as one line: Per serving, 100 g.
  const size = serving
    ? `${serving.name}, ${serving.amount} ${UNIT_LABEL[serving.unit]}`
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
      />
    </div>
  )
}
