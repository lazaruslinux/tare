import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Food } from '../api'
import { HEADLINE, NutritionLabel, factText } from '../components/NutritionLabel'
import {
  UNIT_GROUPS,
  UNIT_LABEL,
  WATER_HINT,
  crossesFamily,
  pickToBase,
  round1,
  type Pick,
  type Unit,
} from '../lib/units'

// The select holds units and the food's own servings in one list, so there is
// only ever one answer to what is being measured. A serving is written down as
// its place in the list rather than its name, which somebody may rename.
const asPick = (choice: string): Pick =>
  choice.startsWith('serving:')
    ? { kind: 'serving', index: Number(choice.slice('serving:'.length)) }
    : { kind: 'unit', unit: choice as Unit }

function Portions({ food }: { food: Food }) {
  const serving = food.servings[0]
  const [amount, setAmount] = useState(serving ? '1' : '100')
  const [choice, setChoice] = useState(serving ? 'serving:0' : food.base_unit)

  const pick = asPick(choice)
  const typed = Number(amount.trim())
  const baseAmount = Number.isFinite(typed) ? pickToBase(food, food.servings, typed, pick) : 0
  // The one case where a number on screen rests on something the label never
  // said. It is marked, and then it is explained.
  const assumesWater =
    pick.kind === 'unit' && crossesFamily(food, pick.unit) && !food.density_g_per_ml

  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">How much</p>

      <div className="mb-3 flex gap-2">
        <input
          className="t-input t-nums w-24 text-right"
          inputMode="decimal"
          aria-label="Amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <select
          className="t-input min-w-0 flex-1"
          aria-label="Unit"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          {food.servings.length > 0 && (
            <optgroup label="Servings">
              {food.servings.map((row, index) => (
                <option key={row.id} value={`serving:${index}`}>
                  {row.name}
                </option>
              ))}
            </optgroup>
          )}
          {UNIT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.units.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABEL[unit]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {food.servings.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {food.servings.map((row, index) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={choice === `serving:${index}`}
              className="t-chip aria-pressed:border-accent aria-pressed:text-text"
              onClick={() => setChoice(`serving:${index}`)}
            >
              {row.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {HEADLINE.map((fact) => (
          <div key={fact.key}>
            <span className="t-nums block text-lg font-semibold">
              {assumesWater && '≈'}
              {factText(food, fact.key, baseAmount)}
              {fact.unit && <span className="text-sm font-normal text-muted">{fact.unit}</span>}
            </span>
            <span className="block text-xs text-muted">{fact.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-xs text-muted">
        {assumesWater && '≈ '}
        {round1(baseAmount)} {food.base_unit}
        {assumesWater && `. ${WATER_HINT}`}
      </p>
    </div>
  )
}

export function FoodDetail({
  id,
  onBack,
  onEdit,
  onDelete,
}: {
  id: number
  onBack: () => void
  onEdit: (food: Food) => void
  onDelete: (food: Food) => void
}) {
  const [food, setFood] = useState<Food | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api<Food>(`/foods/${id}`)
      .then((loaded) => alive && setFood(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [id])

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Food
      </button>

      {error && <p className="t-error">{error}</p>}
      {food && (
        <>
          <p className="text-xl font-semibold tracking-tight">{food.name}</p>
          <p className="mb-3 text-sm text-muted">{food.brand || 'No brand'}</p>

          <NutritionLabel food={food} />
          <Portions food={food} />

          {food.mine && (
            <div className="mb-3 flex gap-3">
              <button className="t-btn flex-1" type="button" onClick={() => onEdit(food)}>
                Edit
              </button>
              <button
                className="t-btn text-danger"
                type="button"
                onClick={() => onDelete(food)}
              >
                Delete
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}
