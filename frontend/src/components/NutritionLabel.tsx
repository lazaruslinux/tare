import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

import type { Food } from '../api'
import { round1, scale } from '../lib/units'

// The panel, as it is stored and as it reads. The form fills in the same list,
// so the two can only ever ask for and show the same ten numbers in the same
// order. Four of them are the ones anybody looks at; the rest are on the label
// when the label bothered.
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

export type Fact = { key: Nutrient; label: string; unit: string }

export const HEADLINE: Fact[] = [
  { key: 'calories', label: 'Calories', unit: '' },
  { key: 'protein_g', label: 'Protein', unit: 'g' },
  { key: 'carbs_g', label: 'Carbs', unit: 'g' },
  { key: 'fat_g', label: 'Fat', unit: 'g' },
]

export const MORE_FACTS: Fact[] = [
  { key: 'saturated_fat_g', label: 'Saturated fat', unit: 'g' },
  { key: 'trans_fat_g', label: 'Trans fat', unit: 'g' },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'fiber_g', label: 'Fibre', unit: 'g' },
  { key: 'sugar_g', label: 'Sugar', unit: 'g' },
]

// A number the label never gave. Not zero, and not left blank either: an empty
// cell reads as a number that failed to load.
const NOTHING = '-'

export function amountText(food: Food, baseAmount: number): string {
  return `${round1(baseAmount)} ${food.base_unit}`
}

export function factText(food: Food, key: Nutrient, baseAmount: number): string {
  const value = scale(food[key], baseAmount)
  if (value === null) return NOTHING
  // Calories are read as a whole number; a tenth of one is noise.
  return String(key === 'calories' ? Math.round(value) : round1(value))
}

export function NutritionLabel({ food }: { food: Food }) {
  const serving = food.servings[0]
  // A food with a serving is read a serving at a time. One without has only the
  // per-100 figures it was stored with, so that is what opens.
  const [perServing, setPerServing] = useState(Boolean(serving))
  const [more, setMore] = useState(false)

  const baseAmount = perServing && serving ? serving.base_amount : 100

  return (
    <div className="t-card mb-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {serving && (
          <button
            type="button"
            aria-pressed={perServing}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => setPerServing(true)}
          >
            Per serving
          </button>
        )}
        <button
          type="button"
          aria-pressed={!perServing}
          className="t-chip aria-pressed:border-accent aria-pressed:text-text"
          onClick={() => setPerServing(false)}
        >
          Per 100 {food.base_unit}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {HEADLINE.map((fact) => (
          <div key={fact.key}>
            <span className="t-nums block text-xl font-semibold">
              {factText(food, fact.key, baseAmount)}
              {fact.unit && <span className="text-sm font-normal text-muted">{fact.unit}</span>}
            </span>
            <span className="block text-xs text-muted">{fact.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-muted">
        {perServing && serving
          ? `${serving.name}, ${amountText(food, serving.base_amount)}`
          : `100 ${food.base_unit}`}
      </p>

      <button
        type="button"
        className="t-micro mt-3 flex items-center gap-1"
        aria-expanded={more}
        onClick={() => setMore(!more)}
      >
        More
        <ChevronDown className={`h-3.5 w-3.5 ${more ? 'rotate-180' : ''}`} strokeWidth={2.5} />
      </button>

      {more && (
        <div className="mt-1">
          {MORE_FACTS.map((fact) => (
            <div key={fact.key} className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">{fact.label}</span>
              <span className="t-nums">
                {factText(food, fact.key, baseAmount)} {fact.unit}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
