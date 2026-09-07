import { Minus, Plus, Scale } from 'lucide-react'
import { useState } from 'react'

import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import { MASS_UNITS, UNIT_LABEL, UNIT_TO_BASE, round1, type Unit } from '../lib/units'
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
  weight,
  weighing = false,
  counted = false,
  error,
  saving,
  onClose,
  onSubmit,
  onDelete,
  deleteLabel = 'Delete',
}: {
  // The quiet line at the top, and what the button says.
  title: string
  action: string
  name: string
  // Null when there is nothing to count, which is a whole kept meal.
  servings: number | null
  slot: Slot
  // What the whole thing weighs in grams, where anything does. Null or absent
  // is nothing to take a share of, so the scale is not offered.
  weight?: number | null
  // Already a weight, which is how a row logged in grams is edited: the field
  // opens on the grams it holds rather than on zero.
  weighing?: boolean
  // Already a count, which is how a standing auto-log set in servings is read
  // back: the scale would otherwise be offered first and the number lost.
  counted?: boolean
  error?: string
  saving?: boolean
  onClose: () => void
  // The amount, and whether it is grams rather than servings.
  onSubmit: (amount: number | null, slot: Slot, byWeight: boolean) => void
  onDelete?: () => void
  // What the button beside the action says, where "Delete" is not the word.
  deleteLabel?: string
}) {
  // Only worth offering the two when there is a weight to take a share of.
  const weighable = typeof weight === 'number' && weight > 0

  // The scale reads in one of three, starting in grams. Grams are what is sent
  // whichever it says.
  const [unit, setUnit] = useState<Unit>('g')
  // Weigh it first, because weighing it is what this app is for, unless what
  // is being read back was already set as a count.
  const [byWeight, setByWeight] = useState(counted ? false : weighing || weighable)
  // A row already logged by weight or already counted opens on the number it
  // holds. Anything else opens on zero for the scale, waiting for what it says.
  const [amount, setAmount] = useState(() => {
    if (servings === null) return ''
    if (weighing || counted) return String(round1(servings))
    return weighable ? '0' : String(servings)
  })
  const [meal, setMeal] = useState<Slot>(slot)
  const typed = Number(amount.trim())
  const counting = servings !== null || byWeight
  const valid = !counting || (Number.isFinite(typed) && typed > 0)

  const step = (by: number) => {
    const from = Number.isFinite(typed) && typed > 0 ? typed : 1
    setAmount(String(Math.max(STEP, round1(from + by))))
  }

  // Switching never rewrites the number as the same portion said another way:
  // two servings is not two grams, and a field that rewrites itself is a field
  // nobody trusts. The scale starts at zero and a count of servings at one.
  const choose = (next: boolean) => {
    if (next !== byWeight) setAmount(next ? '0' : '1')
    setByWeight(next)
  }

  const send = () => {
    if (!counting) {
      onSubmit(null, meal, false)
      return
    }
    // Whole grams, whichever of the three the scale was read in, and never
    // rounded away to nothing.
    const grams = Math.max(1, Math.round(typed * UNIT_TO_BASE[unit]))
    onSubmit(byWeight ? grams : typed, meal, byWeight)
  }

  return (
    <Sheet open label={`${title} ${name}`} onClose={onClose}>
      <p className="t-micro mb-1">{title}</p>
      <p className="text-base font-semibold tracking-tight">{name}</p>

      {weighable && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* The scale first, because weighing it is the answer this would
              rather have. */}
          <button
            type="button"
            aria-pressed={byWeight}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => choose(true)}
          >
            <Scale className="h-3.5 w-3.5" strokeWidth={2.5} />
            Weigh it
          </button>
          <button
            type="button"
            aria-pressed={!byWeight}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => choose(false)}
          >
            Servings
          </button>
        </div>
      )}

      {counting && (
        <>
          <p className="t-micro mt-3 mb-2">{byWeight ? 'Weight' : 'Servings'}</p>
          <div className="flex flex-wrap items-center gap-2">
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
              // The field opens at 0, so typing replaces it rather than
              // making a weight read 0250.
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setAmount(event.target.value)}
            />
            {byWeight ? (
              // The three a scale reads in, beside the field. Switching leaves
              // the number alone: it is what the scale said, not a conversion.
              MASS_UNITS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={unit === option}
                  className="t-chip aria-pressed:border-accent aria-pressed:text-text"
                  onClick={() => setUnit(option)}
                >
                  {UNIT_LABEL[option]}
                </button>
              ))
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
            {deleteLabel}
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
