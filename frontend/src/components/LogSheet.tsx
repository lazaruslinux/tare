import { Minus, Plus, Scale } from 'lucide-react'
import { useState } from 'react'

import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import { MASS_UNITS, UNIT_LABEL, UNIT_TO_BASE, round1, type Unit } from '../lib/units'
import { Sheet } from './Sheet'
import { Switch } from './Switch'

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
  standing,
  autoLogged = false,
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
  // What this thing already auto-logs, by meal, when the sheet is setting that
  // up. One instruction per meal: switching to a meal that has one reads it
  // back, and only a meal that has one can be removed.
  standing?: Partial<Record<Slot, { amount: number; unit: string }>>
  // Whether the row being edited was written by a standing auto-log, which is
  // when the switch that carries the change onto it is worth offering.
  autoLogged?: boolean
  error?: string
  saving?: boolean
  onClose: () => void
  // The amount, whether it is grams rather than servings, and whether the
  // standing auto-log behind the row takes the change with it.
  onSubmit: (amount: number | null, slot: Slot, byWeight: boolean, follow: boolean) => void
  onDelete?: (slot: Slot) => void
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
  // A change to a row an auto-log wrote is meant for the days to come as well
  // unless somebody says otherwise, which is what the day off looks like.
  const [follow, setFollow] = useState(true)
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

  // Which meal is being set. One this thing already auto-logs into is that
  // instruction being edited, so its portion is what the fields read back; a
  // meal without one keeps whatever is typed.
  const chooseMeal = (option: Slot) => {
    setMeal(option)
    const row = standing?.[option]
    if (row === undefined) return
    setByWeight(row.unit === 'g')
    setAmount(String(round1(row.amount)))
  }

  // Nothing to take away while the meal chosen has no instruction of its own.
  const removable = standing === undefined || standing[meal] !== undefined

  const send = () => {
    if (!counting) {
      onSubmit(null, meal, false, follow)
      return
    }
    // Whole grams, whichever of the three the scale was read in, and never
    // rounded away to nothing.
    const grams = Math.max(1, Math.round(typed * UNIT_TO_BASE[unit]))
    onSubmit(byWeight ? grams : typed, meal, byWeight, follow)
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
            onClick={() => chooseMeal(option)}
          >
            {SLOT_LABEL[option]}
          </button>
        ))}
      </div>

      {autoLogged && (
        <div className="mt-3">
          <Switch
            label="Also change the auto-log"
            note="For the days to come as well: this mealtime and this amount."
            checked={follow}
            onChange={setFollow}
          />
        </div>
      )}

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
        {onDelete !== undefined && removable ? (
          <button type="button" className="t-btn text-danger" onClick={() => onDelete(meal)}>
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
