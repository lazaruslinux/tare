import { Scale } from 'lucide-react'
import { useState } from 'react'

import {
  api,
  errorText,
  type AutoLog,
  type DiaryEntry,
  type Food,
  type Headline,
} from '../api'
import { SLOTS, SLOT_LABEL, type Slot } from '../lib/day'
import {
  MASS_UNITS,
  UNIT_GROUPS,
  UNIT_LABEL,
  UNIT_TO_BASE,
  WATER_HINT,
  amountText,
  crossesFamily,
  pickToBase,
  portionText,
  round1,
  scale,
  servingsText,
  type Pick,
  type Unit,
} from '../lib/units'
import { ConfirmSheet } from './ConfirmSheet'
import { Verified } from './FoodRows'
import { HEADLINE, nutrientText } from './NutritionLabel'
import { Sheet } from './Sheet'
import { Switch } from './Switch'

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

// Whether a choice is the scale: one of the three weights, and not a serving or
// something poured.
const isWeight = (choice: string): boolean => MASS_UNITS.includes(choice as Unit)

// One of a serving, and zero of anything measured out: the field waits for what
// the scale says rather than guessing a portion nobody weighed.
const startingAmount = (choice: string): string => (choice.startsWith(SERVING) ? '1' : '0')

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
  // Weigh it first, because weighing it is what this app is for. What somebody
  // chose last for this food still wins, whichever of the three it was.
  const choice = keptChoice(food) ?? 'g'
  return { amount: startingAmount(choice), choice }
}

// What a scale reads: whole grams, and one decimal in ounces or pounds. The
// field keeps what was typed; only the number that is sent is rounded, and it
// never rounds down to nothing.
function scaleAmount(pick: Pick, typed: number): number {
  if (pick.kind === 'serving' || !isWeight(pick.unit)) return typed
  return pick.unit === 'g' ? Math.max(1, Math.round(typed)) : Math.max(0.1, round1(typed))
}

export function PortionSheet({
  food,
  date,
  slot,
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
  entry?: DiaryEntry
  onClose: () => void
  onDone: () => void
  onDelete?: (entry: DiaryEntry) => void
  // Given instead when the portion is being chosen for something else, which
  // is how a recipe and a kept meal are filled in. Nothing is logged: the
  // measurement is handed back and the sheet closes.
  onPick?: (food: Food, amount: number, unit: string) => void
  // Given instead when the portion being chosen is a standing one: the same
  // sheet, ending in the meal it lands in every day. `standing` is every meal
  // this food already auto-logs into, which is one instruction each.
  autoLog?: {
    standing: AutoLog[]
    onSaved: () => void
    onStopped: () => void
  }
}) {
  const [start] = useState(() =>
    opening(food, entry, autoLog?.standing.find((row) => row.slot === slot) ?? null)
  )
  const [amount, setAmount] = useState(start.amount)
  const [choice, setChoice] = useState(start.choice)
  const [meal, setMeal] = useState<Slot>(slot)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // Whether the question about stopping this standing auto-log is up.
  const [stopping, setStopping] = useState(false)
  // A change to a row an auto-log wrote is meant for the days to come as well
  // unless somebody says otherwise, which is what the day off looks like.
  const [follow, setFollow] = useState(true)

  // The instruction for the meal now chosen, or null while that meal has none
  // and this is a new one.
  const standing = autoLog?.standing.find((row) => row.slot === meal) ?? null

  const typed = Number(amount.trim())
  const valid = Number.isFinite(typed) && typed > 0
  const pick = food && choice ? asPick(choice) : null
  // What the field means once the scale's own rounding is applied. Everything
  // downstream reads this, so the tiles preview what will actually be logged.
  const sending = pick !== null && valid ? scaleAmount(pick, typed) : typed
  // Whether the scale is what is being read, which is what the three weights
  // are offered for.
  const weighing = pick?.kind === 'unit' && isWeight(pick.unit)
  const baseAmount = food && pick && valid ? pickToBase(food, food.servings, sending, pick) : 0
  // The one case where a number on screen rests on something the label never
  // said. It is marked, and then it is explained.
  const assumesWater =
    food !== null && pick?.kind === 'unit' && crossesFamily(food, pick.unit) && !food.density_g_per_ml
  // An entry whose food is gone scales what survived it, and nothing else.
  const factor = entry?.amount != null && valid ? sending / entry.amount : 1

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
  // rewrites itself is a field nobody trusts. A serving starts at one and a
  // measured amount at zero, waiting for what the scale says. Swapping one
  // weight for another leaves the number alone: 8 oz reads as 8 lb, not as
  // the half pound eight ounces happens to be.
  const choose = (next: string) => {
    const swap = isWeight(choice) && isWeight(next)
    if (food !== null && next !== choice && !swap) setAmount(startingAmount(next))
    setChoice(next)
  }

  // Which meal is being set. One this food already auto-logs into is that
  // instruction being edited, so its portion is what the fields read back; a
  // meal without one keeps whatever is typed.
  const chooseMeal = (option: Slot) => {
    setMeal(option)
    const row = autoLog?.standing.find((one) => one.slot === option)
    if (row === undefined || food === null) return
    const next = autoChoice(food, row)
    if (next === null) return
    setAmount(String(row.amount))
    setChoice(next)
  }

  // What the portion comes to in the food's own unit, and in servings as well
  // when that is what was chosen: the label prints servings and the scale
  // reads grams, so both are said.
  const baseLine = (row: Food): string => {
    if (!valid) return `- ${row.base_unit}`
    const weighed = `${amountText(baseAmount, row.base_unit)} ${row.base_unit}`
    return pick?.kind === 'serving' ? `${servingsText(sending)} = ${weighed}` : weighed
  }

  // Choosing a portion for something else rather than logging one.
  const picking = onPick !== undefined && food !== null && pick !== null

  const body = () => {
    // Only ever sent on a row an auto-log wrote, where it says whether the
    // standing instruction moves with the day.
    const also = entry?.auto_log_id == null ? {} : { follow_auto_log: follow }
    if (food !== null && pick !== null) {
      const unit = chosenUnit(food, pick)
      return entry
        ? { slot: meal, amount: sending, unit, ...also }
        : { date, slot: meal, food_id: food.id, amount: sending, unit }
    }
    return entry?.amount != null
      ? { slot: meal, amount: sending, ...also }
      : { slot: meal, ...also }
  }

  const save = async () => {
    if (needsAmount && !valid) {
      setError('Type what the scale says.')
      return
    }
    if (picking && food !== null && pick !== null && onPick) {
      keep(food, choice)
      onPick(food, sending, chosenUnit(food, pick))
      return
    }
    if (autoLog && food !== null && pick !== null) {
      setSaving(true)
      setError('')
      try {
        await api(standing === null ? '/diary/auto-logs' : `/diary/auto-logs/${standing.id}`, {
          method: standing === null ? 'POST' : 'PATCH',
          body: {
            ...(standing === null ? { food_id: food.id } : {}),
            amount: sending,
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

  // Turning off the one meal that is chosen. Any other meal this food logs
  // into is a separate instruction and stands. What it already wrote is eaten
  // and stays.
  const stop = async () => {
    if (standing === null || !autoLog) return
    setSaving(true)
    setError('')
    try {
      await api(`/diary/auto-logs/${standing.id}`, { method: 'DELETE' })
      autoLog.onStopped()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  const name = food?.name ?? entry?.name ?? ''
  const brand = food?.brand ?? entry?.brand ?? ''

  return (
    <>
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
          <div className="mt-3 mb-3 flex flex-wrap items-center gap-2">
            <input
              className="t-input t-nums w-24 text-right"
              inputMode="decimal"
              aria-label="Amount"
              placeholder="0"
              value={amount}
              // The field opens at 0, so typing replaces it rather than making
              // the first weight of the day read 0250.
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setAmount(event.target.value)}
            />
            {food === null ? (
              <span className="flex min-h-11 flex-1 items-center text-sm text-muted">
                {entry ? portionText({ ...entry, amount: 1 }) : ''}
              </span>
            ) : (
              <select
                // Wide enough to read a serving's name. The three weights beside
                // it wrap to their own line rather than squeezing it.
                className="t-input min-w-28 flex-1"
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
            {/* The three a scale reads in, beside the field. Switching leaves
                the number alone: it is what the scale said, not a conversion. */}
            {weighing &&
              MASS_UNITS.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  aria-pressed={choice === unit}
                  className="t-chip aria-pressed:border-accent aria-pressed:text-text"
                  onClick={() => choose(unit)}
                >
                  {UNIT_LABEL[unit]}
                </button>
              ))}
          </div>
        )}

        {food !== null && (
          <div className="mb-3 flex flex-wrap gap-2">
            {/* The scale first, because weighing it is the answer this would
                rather have. The label serving is offered as what it is, one
                serving, whatever the label calls it. */}
            <button
              type="button"
              aria-pressed={weighing}
              className="t-chip aria-pressed:border-accent aria-pressed:text-text"
              onClick={() => {
                if (!weighing) choose('g')
              }}
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
                  onClick={() => chooseMeal(option)}
                >
                  {SLOT_LABEL[option]}
                </button>
              ))}
            </div>
          </>
        )}

        {entry?.auto_log_id != null && (
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
            {standing === null ? (
              <button type="button" className="t-btn flex-1" onClick={onClose}>
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className="t-btn flex-1 text-danger"
                disabled={saving}
                onClick={() => setStopping(true)}
              >
                Stop auto-logging
              </button>
            )}
          </div>
        )}
      </Sheet>
      <ConfirmSheet
        open={stopping}
        label="Stop auto-logging"
        question={`Stop auto-logging ${name} at ${SLOT_LABEL[meal]}?`}
        note="Days already written keep their entries."
        verb="Stop"
        busy={saving}
        onConfirm={() => {
          setStopping(false)
          void stop()
        }}
        onClose={() => setStopping(false)}
      />
    </>
  )
}
