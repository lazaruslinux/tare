import { useEffect, useRef, useState } from 'react'

import {
  api,
  errorText,
  type DiaryDay,
  type DiaryEntry,
  type Food,
  type Headline,
  type Me,
} from '../api'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { LogSheet } from '../components/LogSheet'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { useTopBar } from '../hooks/useTopBar'
import { SLOTS, SLOT_LABEL, dayLabel, shiftDay, slotByTime, today, type Slot } from '../lib/day'
import { portionText, round1, servingsText, weightText } from '../lib/units'

// How long a deleted row can be brought back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

// What is waiting to be deleted: a logged food or a logged workout. Both leave
// the screen at once and both settle when the window closes.
type Pending = { kind: 'food' | 'exercise'; id: number; name: string }

// One nutrient across a set of entries, by the rule the server uses: a missing
// figure counts as nothing, and a nutrient that no entry carries at all stays
// missing rather than becoming zero.
function tally(entries: DiaryEntry[], key: Headline): number | null {
  const carried = entries.filter((row) => row[key] !== null)
  return carried.length === 0 ? null : carried.reduce((sum, row) => sum + (row[key] ?? 0), 0)
}

// The day with one row taken out of it, added up again. The row leaves the
// screen at once and the request waits, so undoing is not a second write
// putting back what a first one destroyed. Only the four figures this screen
// reads are corrected; the rest are replaced by the next read either way.
function without(day: DiaryDay, gone: DiaryEntry): DiaryDay {
  const slots = {} as DiaryDay['slots']
  const left: DiaryEntry[] = []
  for (const slot of SLOTS) {
    const entries = day.slots[slot].entries.filter((row) => row.id !== gone.id)
    slots[slot] = { entries, subtotal_calories: tally(entries, 'calories') }
    left.push(...entries)
  }
  const totals = { ...day.totals }
  for (const fact of HEADLINE) totals[fact.key] = tally(left, fact.key)
  return {
    ...day,
    totals,
    slots,
    remaining_calories: day.remaining_calories + (gone.calories ?? 0),
  }
}

// The same, for a workout: it stops being added back the moment it leaves.
function withoutExercise(day: DiaryDay, id: number): DiaryDay {
  const gone = day.exercise.find((row) => row.id === id)
  const exercise = day.exercise.filter((row) => row.id !== id)
  return {
    ...day,
    exercise,
    exercise_kcal: day.exercise_kcal - (gone?.kcal ?? 0),
    remaining_calories: day.remaining_calories - (gone?.kcal ?? 0),
  }
}

// The brand and the portion, whichever of them there is. A recipe is counted in
// servings of itself rather than measured in anything.
const under = (entry: DiaryEntry) =>
  entry.recipe_id !== null && entry.amount !== null
    ? servingsText(entry.amount)
    : [entry.brand, portionText(entry)].filter(Boolean).join(' · ')

type Editing = { entry: DiaryEntry; food: Food | null; slot: Slot }

export function Journal({
  me,
  refresh,
  onDay,
}: {
  me: Me
  refresh: number
  // Which day is on screen, told to the shell so its centre control adds to
  // the day being read rather than always to today.
  onDay: (date: string) => void
}) {
  const todayIso = today(me.timezone)
  const [date, setDate] = useState(todayIso)
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)
  const [picking, setPicking] = useState<Slot | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [exercising, setExercising] = useState(false)
  // A logged recipe is edited by the serving, which is the only thing about it
  // that can change.
  const [servings, setServings] = useState<{ entry: DiaryEntry; slot: Slot } | null>(null)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState('')

  // The day chooser is this tab's header, so the day is picked in one place
  // and the page below is only the day itself. The plus adds to the day on
  // screen, at the meal the hour makes likely.
  useTopBar({
    title: dayLabel(date, todayIso),
    pager: {
      atToday: date >= todayIso,
      onStep: (days) => setDate(shiftDay(date, days)),
      onToday: () => setDate(todayIso),
    },
    action: { label: 'Add food', onAct: () => setPicking(slotByTime(me.timezone)) },
  })

  useEffect(() => onDay(date), [date, onDay])

  // A deletion that has not happened yet.
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  const erase = (row: Pending) => {
    pendingRef.current = null
    const path = row.kind === 'food' ? `/diary/${row.id}` : `/health/exercise/${row.id}`
    api(path, { method: 'DELETE' }).catch(() => {
      // The row is already off the screen. Saying so now, on a day somebody has
      // moved on from, would be noise; the next read tells the truth.
    })
  }

  useEffect(() => {
    let alive = true
    api<DiaryDay>(`/diary/day?date=${date}`)
      .then((loaded) => alive && setDay(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [date, again, refresh])

  useEffect(() => {
    if (pending === null) return
    const timer = window.setTimeout(() => {
      erase(pending)
      setPending(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [pending])

  // Leaving the page is the window closing. Anything still waiting is settled
  // on the way out rather than quietly forgotten.
  useEffect(
    () => () => {
      if (pendingRef.current !== null) erase(pendingRef.current)
    },
    []
  )

  const reload = () => {
    setPicking(null)
    setEditing(null)
    setServings(null)
    setMeasuring(false)
    setExercising(false)
    setAgain(again + 1)
  }

  const openEntry = async (entry: DiaryEntry, slot: Slot) => {
    if (entry.recipe_id !== null) {
      setRefusal('')
      setServings({ entry, slot })
      return
    }
    let food: Food | null = null
    if (entry.food_id !== null) {
      // A food that has since gone leaves the entry standing, and it is edited
      // as what it is: a portion and the numbers that survived it.
      food = await api<Food>(`/foods/${entry.food_id}`).catch(() => null)
    }
    setEditing({ entry, food, slot })
  }

  const changeServings = async (amount: number | null, slot: Slot) => {
    if (servings === null || amount === null) return
    setSaving(true)
    setRefusal('')
    try {
      await api(`/diary/${servings.entry.id}`, { method: 'PATCH', body: { amount, slot } })
      reload()
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  const hold = (row: Pending) => {
    pendingRef.current = row
    setPending(row)
  }

  const remove = (entry: DiaryEntry) => {
    setEditing(null)
    setServings(null)
    setDay((current) => (current === null ? current : without(current, entry)))
    hold({ kind: 'food', id: entry.id, name: entry.name })
  }

  const removeExercise = (id: number, name: string) => {
    setDay((current) => (current === null ? current : withoutExercise(current, id)))
    hold({ kind: 'exercise', id, name })
  }

  const undo = () => {
    pendingRef.current = null
    setPending(null)
    setAgain(again + 1)
  }

  const empty = day !== null && SLOTS.every((slot) => day.slots[slot].entries.length === 0)
  const weighed = day?.measurement ?? null

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      {day !== null && (
        <div className="t-card mb-3">
          <p className="t-micro mb-1">Left today</p>
          <span className="t-nums block text-3xl font-semibold leading-tight">
            {day.remaining_calories}
          </span>
          <span className="block text-xs text-muted">
            {nutrientText('calories', day.totals.calories ?? 0)} eaten of {day.budget.calories}
            {day.exercise_kcal > 0 && ` · Exercise added back +${day.exercise_kcal}`}
          </span>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {HEADLINE.slice(1).map((fact) => (
              <div key={fact.key}>
                <span className="t-nums block text-sm font-semibold">
                  {nutrientText(fact.key, day.totals[fact.key])}
                  <span className="font-normal text-muted">
                    {' '}
                    / {day.budget[fact.key]}
                    {fact.unit}
                  </span>
                </span>
                <span className="block text-xs text-muted">{fact.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {day !== null && empty && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing logged yet. Add your first food.</p>
          <button
            type="button"
            className="t-btn t-btn-primary mt-3"
            onClick={() => setPicking(slotByTime(me.timezone))}
          >
            Add food
          </button>
        </div>
      )}

      {day !== null && !empty && (
        <>
          {SLOTS.map((slot) => (
            <div key={slot} className="t-card mb-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="t-micro">{SLOT_LABEL[slot]}</p>
                {day.slots[slot].subtotal_calories !== null && (
                  <span className="t-nums text-xs text-muted">
                    {nutrientText('calories', day.slots[slot].subtotal_calories)} cal
                  </span>
                )}
              </div>
              {day.slots[slot].entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => openEntry(entry, slot)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{entry.name}</span>
                    {under(entry) && (
                      <span className="block truncate text-xs text-muted">{under(entry)}</span>
                    )}
                  </span>
                  <span className="t-nums shrink-0 text-sm">
                    {nutrientText('calories', entry.calories)}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="t-row w-full text-left text-sm text-muted"
                onClick={() => setPicking(slot)}
              >
                + Add
              </button>
            </div>
          ))}
        </>
      )}

      {day !== null && (
        <div className="t-card mb-3">
          <p className="t-micro mb-1">Measurements</p>
          {weighed === null ? (
            <p className="text-sm text-muted">No measurements yet.</p>
          ) : (
            <>
              <div className="t-row min-h-9 text-sm">
                <span className="flex-1 text-muted">Weight</span>
                <span className="t-nums">{weightText(weighed.weight_kg, me.units)}</span>
              </div>
              {weighed.body_fat_pct !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Body fat</span>
                  <span className="t-nums">{round1(weighed.body_fat_pct)}%</span>
                </div>
              )}
              {weighed.body_water_pct !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Body water</span>
                  <span className="t-nums">{round1(weighed.body_water_pct)}%</span>
                </div>
              )}
              {weighed.muscle_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Muscle</span>
                  <span className="t-nums">{weightText(weighed.muscle_kg, me.units)}</span>
                </div>
              )}
              {weighed.bone_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Bone</span>
                  <span className="t-nums">{weightText(weighed.bone_kg, me.units)}</span>
                </div>
              )}
              {weighed.visceral_fat !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Visceral rating</span>
                  <span className="t-nums">{weighed.visceral_fat}</span>
                </div>
              )}
              {weighed.lean_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Lean weight</span>
                  <span className="t-nums">{weightText(weighed.lean_kg, me.units)}</span>
                </div>
              )}
            </>
          )}
          <button
            type="button"
            className="t-row w-full text-left text-sm text-muted"
            onClick={() => setMeasuring(true)}
          >
            {weighed === null ? '+ Add' : '+ Edit'}
          </button>
        </div>
      )}

      {day !== null && (
        <div className="t-card mb-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="t-micro">Exercise</p>
            {day.exercise_kcal > 0 && (
              <span className="t-nums text-xs text-muted">+{day.exercise_kcal} cal</span>
            )}
          </div>
          {day.exercise.length === 0 ? (
            <p className="text-sm text-muted">No exercise logged.</p>
          ) : (
            day.exercise.map((row) => (
              <div key={row.id} className="t-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.name}</span>
                  <span className="block text-xs text-muted">
                    {row.minutes} min · about {row.kcal} cal
                  </span>
                </span>
                <button
                  type="button"
                  className="t-tap44 shrink-0 text-sm text-muted"
                  onClick={() => removeExercise(row.id, row.name)}
                >
                  Delete
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="t-row w-full text-left text-sm text-muted"
            onClick={() => setExercising(true)}
          >
            + Add
          </button>
        </div>
      )}

      {picking !== null && (
        <FoodPicker
          me={me}
          date={date}
          slot={picking}
          onClose={() => setPicking(null)}
          onLogged={reload}
        />
      )}

      {measuring && (
        <MeasurementsSheet
          me={me}
          date={date}
          onClose={() => setMeasuring(false)}
          onSaved={reload}
        />
      )}

      {exercising && (
        <ExerciseSheet date={date} onClose={() => setExercising(false)} onSaved={reload} />
      )}

      {editing !== null && (
        <PortionSheet
          food={editing.food}
          date={date}
          slot={editing.slot}
          units={me.units}
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDone={reload}
          onDelete={remove}
        />
      )}

      {servings !== null && (
        <LogSheet
          title="Edit"
          action="Save"
          name={servings.entry.name}
          servings={servings.entry.amount ?? 1}
          slot={servings.slot}
          error={refusal}
          saving={saving}
          onClose={() => setServings(null)}
          onSubmit={(amount, slot) => void changeServings(amount, slot)}
          onDelete={() => remove(servings.entry)}
        />
      )}

      {pending !== null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
          <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
            <span className="min-w-0 truncate">Deleted {pending.name}.</span>
            <button type="button" className="font-semibold text-accent" onClick={undo}>
              Undo
            </button>
          </div>
        </div>
      )}
    </>
  )
}
