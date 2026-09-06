import { Minus, Plus, Scale } from 'lucide-react'
import { useState } from 'react'

import type { Units } from '../api'
import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import { UNIT_TO_BASE, round1 } from '../lib/units'
import { Sheet } from './Sheet'

// The little a recipe or a kept meal needs before it goes in the diary: how
// much of it, and which meal it belongs to. A food needs more than this, and
// PortionSheet is where that lives.

// What one tap changes the count by. Half a serving is the smallest thing
// anybody says out loud about a pot of something.
const STEP = 0.5

export function LogSheet({
  title,
  action,
  name,
  servings,
  slot,
  units,
  weight,
  weighing = false,
  error,
  saving,
  onClose,
  onSubmit,
  onDelete,
}: {
  // The quiet line at the top, and what the button says.
  title: string
  action: string
  name: string
  // Null when there is nothing to count, which is a whole kept meal.
  servings: number | null
  slot: Slot
  // Which weight this account reads in, for the scale.
  units: Units
  // What the whole thing weighs in grams, where anything does. Null or absent
  // is nothing to take a share of, so the scale is not offered.
  weight?: number | null
  // Open on the scale rather than the count, which is how a row already
  // logged by weight is edited.
  weighing?: boolean
  error?: string
  saving?: boolean
  onClose: () => void
  // The amount, and whether it is grams rather than servings.
  onSubmit: (amount: number | null, slot: Slot, byWeight: boolean) => void
  onDelete?: () => void
}) {
  // The scale reads in whichever weight this account reads in, and grams are
  // what is sent whatever it says.
  const scaleUnit = units === 'metric' ? 'g' : 'oz'

  const [byWeight, setByWeight] = useState(weighing)
  // A row already logged by weight opens on what it weighs, said in the unit
  // this account reads: the amount handed in is always grams.
  const [amount, setAmount] = useState(() => {
    if (servings === null) return ''
    return weighing ? String(round1(servings / UNIT_TO_BASE[scaleUnit])) : String(servings)
  })
  const [meal, setMeal] = useState<Slot>(slot)
  const typed = Number(amount.trim())
  const counting = servings !== null || byWeight
  const valid = !counting || (Number.isFinite(typed) && typed > 0)
  // Only worth offering the two when there is a weight to take a share of.
  const weighable = typeof weight === 'number' && weight > 0

  const step = (by: number) => {
    const from = Number.isFinite(typed) && typed > 0 ? typed : 1
    setAmount(String(Math.max(STEP, round1(from + by))))
  }

  // Switching never rewrites the number as the same portion said another way:
  // two servings is not two grams, and a field that rewrites itself is a field
  // nobody trusts.
  const choose = (next: boolean) => {
    if (next !== byWeight) setAmount(next ? '' : '1')
    setByWeight(next)
  }

  const send = () => {
    if (!counting) {
      onSubmit(null, meal, false)
      return
    }
    // Whole grams, whichever way the scale was read.
    onSubmit(byWeight ? Math.round(typed * UNIT_TO_BASE[scaleUnit]) : typed, meal, byWeight)
  }

  return (
    <Sheet open label={`${title} ${name}`} onClose={onClose}>
      <p className="t-micro mb-1">{title}</p>
      <p className="text-base font-semibold tracking-tight">{name}</p>

      {weighable && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={!byWeight}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => choose(false)}
          >
            Servings
          </button>
          <button
            type="button"
            aria-pressed={byWeight}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => choose(true)}
          >
            <Scale className="h-3.5 w-3.5" strokeWidth={2.5} />
            Weigh it
          </button>
        </div>
      )}

      {counting && (
        <>
          <p className="t-micro mt-3 mb-2">{byWeight ? 'Weight' : 'Servings'}</p>
          <div className="flex items-center gap-2">
            {!byWeight && (
              <button
                type="button"
                className="t-btn w-12"
                aria-label="Less"
                onClick={() => step(-STEP)}
              >
                <Minus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
            <input
              className="t-input t-nums w-24 text-center"
              inputMode="decimal"
              aria-label={byWeight ? 'Weight' : 'Servings'}
              placeholder={byWeight ? '0' : ''}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {byWeight ? (
              <span className="text-sm text-muted">{scaleUnit}</span>
            ) : (
              <button
                type="button"
                className="t-btn w-12"
                aria-label="More"
                onClick={() => step(STEP)}
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </>
      )}

      <p className="t-micro mt-3 mb-2">Meal</p>
      <div className="flex flex-wrap gap-2">
        {SLOTS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={meal === option}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => setMeal(option)}
          >
            {SLOT_LABEL[option]}
          </button>
        ))}
      </div>

      {error && <p className="t-error mt-3">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="t-btn t-btn-primary flex-1"
          disabled={saving || !valid}
          onClick={send}
        >
          {action}
        </button>
        {onDelete ? (
          <button type="button" className="t-btn text-danger" onClick={onDelete}>
            Delete
          </button>
        ) : (
          <button type="button" className="t-btn" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </Sheet>
  )
}
