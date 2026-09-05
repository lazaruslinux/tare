import { Scale } from 'lucide-react'
import { useState } from 'react'

import {
  api,
  errorText,
  type AutoLog,
  type DiaryEntry,
  type Food,
  type Headline,
  type Units,
} from '../api'
import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import {
  UNIT_GROUPS,
  UNIT_LABEL,
  UNIT_TO_BASE,
  WATER_HINT,
  amountText,
  crossesFamily,
  pickToBase,
  portionText,
  scale,
  servingsText,
  type Pick,
  type Unit,
} from '../lib/units'
import { Verified } from './FoodRows'
import { HEADLINE, nutrientText } from './NutritionLabel'
import { Sheet } from './Sheet'

// How a food was last measured, kept per food on this device. Somebody who
// weighs their oats and counts their biscuits should not have to say so twice.
const remembered = (foodId: number) => `tare.portion.${foodId}`

const SERVING = 'serving:'

// The one list holds units and the food's own servings, so there is only ever
// one answer to what is being measured. A serving is written down as its place
// in the list rather than its name, which somebody may rename.
const asPick = (choice: string): Pick =>
  choice.startsWith(SERVING)
    ? { kind: 'serving', index: Number(choice.slice(SERVING.length)) }
    : { kind: 'unit', unit: choice as Unit }

function keptChoice(food: Food): string | null {
  let kept: string | null = null
  try {
    kept = window.localStorage.getItem(remembered(food.id))
  } catch {
    // Storage turned off, or a private window. The default below is fine.
    return null
  }
  if (kept === null) return null
  if (kept.startsWith(SERVING)) {
    // A serving that has since been deleted would otherwise open the sheet on
    // a measurement the food no longer has.
    const index = Number(kept.slice(SERVING.length))
    return Number.isInteger(index) && index >= 0 && index < food.servings.length ? kept : null
  }
  return kept in UNIT_TO_BASE ? kept : null
}

function keep(food: Food, choice: string) {
  try {
    window.localStorage.setItem(remembered(food.id), choice)
  } catch {
    // Not remembering is not worth an error on screen.
  }
}

// What the sheet is measuring in, as the server reads it: a unit from a measure
// family, or one of the food's own servings by its id.
const chosenUnit = (food: Food, pick: Pick): string =>
  pick.kind === 'serving' ? `${SERVING}${food.servings[pick.index].id}` : pick.unit

// What an entry was measured in, as a choice the control understands. A serving
// is found again by the name the entry kept of it.
function entryChoice(food: Food, entry: DiaryEntry): string | null {
  if (entry.unit === null) return null
  if (entry.unit !== 'serving') return entry.unit in UNIT_TO_BASE ? entry.unit : null
  const index = food.servings.findIndex((row) => row.name === entry.serving_label)
  return index < 0 ? null : `${SERVING}${index}`
}

// What a standing auto-log was set to, as a choice the control understands. A
// serving is found again by its id, which is what the auto-log kept.
function autoChoice(food: Food, row: AutoLog): string | null {
  if (row.unit.startsWith(SERVING)) {
    const index = food.servings.findIndex((serving) => serving.id === Number(row.unit.slice(SERVING.length)))
    return index < 0 ? null : `${SERVING}${index}`
  }
  return row.unit in UNIT_TO_BASE ? row.unit : null
}

// One of a serving, a hundred of the food's own base unit, and one of anything
// else: nobody's portion is a hundred ounces.
const startingAmount = (food: Food, choice: string): string =>
  choice.startsWith(SERVING) || choice !== food.base_unit ? '1' : '100'

function opening(
  food: Food | null,
  entry?: DiaryEntry,
  standing?: AutoLog | null
): { amount: string; choice: string } {
  if (food === null) return { amount: entry?.amount == null ? '' : String(entry.amount), choice: '' }
  if (standing) {
    const choice = autoChoice(food, standing)
    if (choice !== null) return { amount: String(standing.amount), choice }
  }
  if (entry) {
    const choice = entryChoice(food, entry)
    if (choice !== null) return { amount: String(entry.amount ?? 1), choice }
  }
  const choice = keptChoice(food) ?? (food.servings.length > 0 ? `${SERVING}0` : food.base_unit)
  return { amount: startingAmount(food, choice), choice }
}

export function PortionSheet({
  food,
  date,
  slot,
  units,
  entry,
  onClose,
  onDone,
  onDelete,
  onPick,
  autoLog,
}: {
  // Null when the food an entry came from has been deleted. What is left is a
  // portion and a set of numbers, and only the amount can still change.
  food: Food | null
  date: string
  slot: Slot
  units: Units
  entry?: DiaryEntry
  onClose: () => void
  onDone: () => void
  onDelete?: (entry: DiaryEntry) => void
  // Given instead when the portion is being chosen for something else, which
  // is how a recipe and a kept meal are filled in. Nothing is logged: the
  // measurement is handed back and the sheet closes.
  onPick?: (food: Food, amount: number, unit: string) => void
  // Given instead when the portion being chosen is a standing one: the same
  // sheet, ending in the meal it lands in every day. `existing` is the one
  // already set for this food, or null for a new one.
  autoLog?: {
    existing: AutoLog | null
    onSaved: () => void
    onStopped: () => void
  }
}) {
  const [start] = useState(() => opening(food, entry, autoLog?.existing))
  const [amount, setAmount] = useState(start.amount)
  const [choice, setChoice] = useState(start.choice)
  const [meal, setMeal] = useState<Slot>(autoLog?.existing?.slot ?? slot)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // The chip that turns any food into something on a scale, in whichever unit
  // this account reads weights in.
  const weighIn: Unit = units === 'metric' ? 'g' : 'oz'

  const typed = Number(amount.trim())
  const valid = Number.isFinite(typed) && typed > 0
  const pick = food && choice ? asPick(choice) : null
  const baseAmount = food && pick && valid ? pickToBase(food, food.servings, typed, pick) : 0
  // The one case where a number on screen rests on something the label never
  // said. It is marked, and then it is explained.
  const assumesWater =
    food !== null && pick?.kind === 'unit' && crossesFamily(food, pick.unit) && !food.density_g_per_ml
  // An entry whose food is gone scales what survived it, and nothing else.
  const factor = entry?.amount != null && valid ? typed / entry.amount : 1

  const needsAmount = food !== null || entry?.amount != null

  const value = (key: Headline): number | null => {
    // An empty field is not zero calories of anything. The tiles wait for a
    // number rather than reading as a portion of nothing.
    if (needsAmount && !valid) return null
    if (food !== null) return scale(food[key], baseAmount)
    const carried = entry ? entry[key] : null
    return carried === null ? null : carried * factor
  }

  // Switching measurement never rewrites the number as the same portion said
  // another way: two of something is not two grams of it, and a field that
  // rewrites itself is a field nobody trusts. A serving starts at one, and a
  // weight starts empty, waiting for what the scale says.
  const choose = (next: string) => {
    if (food !== null && next !== choice) setAmount(next.startsWith(SERVING) ? '1' : '')
    setChoice(next)
  }

  // What the portion comes to in the food's own unit, and in servings as well
  // when that is what was chosen: the label prints servings and the scale
  // reads grams, so both are said.
  const baseLine = (row: Food): string => {
    if (!valid) return `- ${row.base_unit}`
    const weighed = `${amountText(baseAmount, row.base_unit)} ${row.base_unit}`
    return pick?.kind === 'serving' ? `${servingsText(typed)} = ${weighed}` : weighed
  }

  // Choosing a portion for something else rather than logging one.
  const picking = onPick !== undefined && food !== null && pick !== null

  const body = () => {
    if (food !== null && pick !== null) {
      const unit = chosenUnit(food, pick)
      return entry
        ? { slot: meal, amount: typed, unit }
        : { date, slot: meal, food_id: food.id, amount: typed, unit }
    }
    return entry?.amount != null ? { slot: meal, amount: typed } : { slot: meal }
  }

  const save = async () => {
    if (needsAmount && !valid) {
      setError('Type what the scale says.')
      return
    }
    if (picking && food !== null && pick !== null && onPick) {
      keep(food, choice)
      onPick(food, typed, chosenUnit(food, pick))
      return
    }
    if (autoLog && food !== null && pick !== null) {
      setSaving(true)
      setError('')
      const standing = autoLog.existing
      try {
        await api(standing === null ? '/diary/auto-logs' : `/diary/auto-logs/${standing.id}`, {
          method: standing === null ? 'POST' : 'PATCH',
          body: {
            ...(standing === null ? { food_id: food.id } : {}),
            amount: typed,
            unit: chosenUnit(food, pick),
            slot: meal,
          },
        })
        autoLog.onSaved()
      } catch (failure) {
        setError(errorText(failure))
        setSaving(false)
      }
      return
    }
    setSaving(true)
    setError('')
    try {
      await api(entry ? `/diary/${entry.id}` : '/diary', {
        method: entry ? 'PATCH' : 'POST',
        body: body(),
      })
      if (food !== null && choice) keep(food, choice)
      onDone()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  // Turning it off. What it has already written down is eaten and stays.
  const stop = async () => {
    if (!autoLog?.existing) return
    setSaving(true)
    setError('')
    try {
      await api(`/diary/auto-logs/${autoLog.existing.id}`, { method: 'DELETE' })
      autoLog.onStopped()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  const name = food?.name ?? entry?.name ?? ''
  const brand = food?.brand ?? entry?.brand ?? ''

  return (
    <Sheet
      open
      label={
        autoLog ? 'Auto-log' : picking ? 'Choose a portion' : entry ? 'Edit entry' : 'Log food'
      }
      onClose={onClose}
    >
      <p className="t-micro mb-1">
        {autoLog ? 'Auto-log' : picking ? 'How much' : entry ? 'Edit' : 'Log'}
      </p>
      {/* A food the shared database holds wears the same check it wears in every
          list, and says so in words: a scan that lands here has found a food
          Tare already knows. */}
      <p className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
        <span className="min-w-0">{name}</span>
        {food?.status === 'approved' && <Verified className="h-4 w-4" />}
      </p>
      {brand && <p className="text-xs text-muted">{brand}</p>}
      {food?.status === 'approved' && <p className="text-xs text-muted">In Tare database</p>}
      {food?.status === 'pending' && (
        // Theirs to log today, and not anybody else's until it is approved.
        <span className="t-chip mt-2">Waiting for approval</span>
      )}

      {needsAmount && (
        <div className="mt-3 mb-3 flex gap-2">
          <input
            className="t-input t-nums w-24 text-right"
            inputMode="decimal"
            aria-label="Amount"
            placeholder="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          {food === null ? (
            <span className="flex min-h-11 flex-1 items-center text-sm text-muted">
              {entry ? portionText({ ...entry, amount: 1 }) : ''}
            </span>
          ) : (
            <select
              className="t-input min-w-0 flex-1"
              aria-label="Unit"
              value={choice}
              onChange={(event) => choose(event.target.value)}
            >
              {food.servings.length > 0 && (
                <optgroup label="Servings">
                  {food.servings.map((row, index) => (
                    <option key={row.id} value={`${SERVING}${index}`}>
                      {row.name}, {amountText(row.amount, row.unit)} {UNIT_LABEL[row.unit]}
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
          )}
        </div>
      )}

      {food !== null && (
        <div className="mb-3 flex flex-wrap gap-2">
          {/* The scale first, because weighing it is the answer this would
              rather have. The label serving is offered as what it is, one
              serving, whatever the label calls it. */}
          <button
            type="button"
            aria-pressed={choice === weighIn}
            className="t-chip aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => choose(weighIn)}
          >
            <Scale className="h-3.5 w-3.5" strokeWidth={2.5} />
            Weigh it
          </button>
          {food.servings.map((row, index) => (
            <button
              key={row.id}
              type="button"
              aria-pressed={choice === `${SERVING}${index}`}
              className="t-chip aria-pressed:border-accent aria-pressed:text-text"
              onClick={() => choose(`${SERVING}${index}`)}
            >
              {index === 0 ? '1 serving' : row.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {HEADLINE.map((fact) => (
          <div key={fact.key}>
            <span className="t-nums block text-lg font-semibold">
              {assumesWater && '≈'}
              {nutrientText(fact.key, value(fact.key))}
              {fact.unit && <span className="text-sm font-normal text-muted">{fact.unit}</span>}
            </span>
            <span className="block text-xs text-muted">{fact.label}</span>
          </div>
        ))}
      </div>

      {food !== null && (
        <p className="mt-2 text-xs text-muted">
          {assumesWater && '≈ '}
          {baseLine(food)}
          {assumesWater && `. ${WATER_HINT}`}
        </p>
      )}
      {food === null && (
        <p className="mt-2 text-xs text-muted">
          This food is gone. The numbers move with the amount and nothing else.
        </p>
      )}

      {!picking && (
        <>
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
        </>
      )}

      {error && <p className="t-error mt-3">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="t-btn t-btn-primary flex-1"
          disabled={saving || (needsAmount && !valid)}
          onClick={save}
        >
          {autoLog ? 'Auto-log every day' : picking ? 'Add' : entry ? 'Save' : 'Log'}
        </button>
        {entry && onDelete ? (
          <button type="button" className="t-btn text-danger" onClick={() => onDelete(entry)}>
            Delete
          </button>
        ) : (
          !autoLog && (
            <button type="button" className="t-btn" onClick={onClose}>
              Cancel
            </button>
          )
        )}
      </div>
      {autoLog !== undefined && (
        <div className="mt-3 flex gap-3">
          {autoLog.existing === null ? (
            <button type="button" className="t-btn flex-1" onClick={onClose}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="t-btn flex-1 text-danger"
              disabled={saving}
              onClick={() => void stop()}
            >
              Stop auto-logging
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}
