import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'

import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import { round1 } from '../lib/units'
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
  error?: string
  saving?: boolean
  onClose: () => void
  onSubmit: (servings: number | null, slot: Slot) => void
  onDelete?: () => void
}) {
  const [amount, setAmount] = useState(servings === null ? '' : String(servings))
  const [meal, setMeal] = useState<Slot>(slot)

  const typed = Number(amount.trim())
  const counting = servings !== null
  const valid = !counting || (Number.isFinite(typed) && typed > 0)

  const step = (by: number) => {
    const from = Number.isFinite(typed) && typed > 0 ? typed : 1
    setAmount(String(Math.max(STEP, round1(from + by))))
  }

  return (
    <Sheet open label={`${title} ${name}`} onClose={onClose}>
      <p className="t-micro mb-1">{title}</p>
      <p className="text-base font-semibold tracking-tight">{name}</p>

      {counting && (
        <>
          <p className="t-micro mt-3 mb-2">Servings</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="t-btn w-12"
              aria-label="Less"
              onClick={() => step(-STEP)}
            >
              <Minus className="h-4 w-4" strokeWidth={2.5} />
            </button>
            <input
              className="t-input t-nums w-24 text-center"
              inputMode="decimal"
              aria-label="Servings"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <button
              type="button"
              className="t-btn w-12"
              aria-label="More"
              onClick={() => step(STEP)}
            >
              <Plus className="h-4 w-4" strokeWidth={2.5} />
            </button>
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
          onClick={() => onSubmit(counting ? typed : null, meal)}
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
