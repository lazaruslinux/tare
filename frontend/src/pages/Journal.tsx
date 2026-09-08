import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  SOURCE_LABEL,
  STALE,
  type DiaryDay,
  type DiaryEntry,
  type Food,
  type Headline,
  type Me,
} from '../api'
import { ActivityIcon } from '../components/ActivityIcon'
import { BreakdownCard } from '../components/BreakdownCard'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { ExerciseSheet } from '../components/ExerciseSheet'
import { FoodPicker } from '../components/FoodPicker'
import { LogSheet } from '../components/LogSheet'
import { MacroBar } from '../components/MacroBar'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { VitaminsSheet } from '../components/VitaminsSheet'
import { WorkoutDetails } from '../components/WorkoutDetails'
import { useTopBar } from '../hooks/useTopBar'
import { SLOTS, SLOT_LABEL, dayLabel, shiftDay, slotByTime, today, type Slot } from '../lib/day'
import { calText } from '../lib/targets'
import { portionText, round1, servingsText, weightText } from '../lib/units'

// The day as the completed line names it: two digits each, in the order it is
// read aloud here.
const shortDate = (iso: string): string => {
  const [year, month, day] = iso.split('-')
  return `${month}/${day}/${year.slice(2)}`
}

// What is waiting on an answer: a logged food or a logged workout. Nothing is
// sent until the question on screen is answered.
type Asking =
  | { kind: 'food'; entry: DiaryEntry }
  | { kind: 'exercise'; id: number; name: string }

// One nutrient across a set of entries, by the rule the server uses: a missing
// figure counts as nothing, and a nutrient that no entry carries at all stays
// missing rather than becoming zero.
function tally(entries: DiaryEntry[], key: Headline): number | null {
  const carried = entries.filter((row) => row[key] !== null)
  return carried.length === 0 ? null : carried.reduce((sum, row) => sum + (row[key] ?? 0), 0)
}

// The day with one row taken out of it, added up again. The row leaves the
// screen the moment the deletion is answered for. Only the four figures this
// screen reads are corrected; the rest are replaced by the next read either
// way.
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
    remaining_calories: day.remaining_calories + Math.round(gone.calories ?? 0),
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

// The brand and the portion, whichever of them there is. A recipe and a kept
// meal are counted in servings of themselves, unless they were weighed, in
// which case the row reads in grams like any other portion.
const counted = (entry: DiaryEntry) => wholeThing(entry) && entry.unit === 'serving'

// A recipe or a kept meal: one line for a whole thing, however it was
// measured, which is edited in the sheet that counts it.
const wholeThing = (entry: DiaryEntry) => entry.recipe_id !== null || entry.meal_id !== null

const under = (entry: DiaryEntry) =>
  counted(entry) && entry.amount !== null
    ? servingsText(entry.amount)
    : [entry.brand, portionText(entry)].filter(Boolean).join(' · ')

type Editing = { entry: DiaryEntry; food: Food | null; slot: Slot }

export function Journal({
  me,
  refresh,
  wantDate,
  onDay,
  onScan,
  onOpenTargets,
  onChanged,
}: {
  me: Me
  refresh: number
  // A day somebody was sent to from another tab. Empty means today, and the
  // pager is free to walk away from it once the tab is open.
  wantDate?: string
  // Said upward when a sub-view changed a list the rest of the app is showing.
  onChanged?: () => void
  // Which day is on screen, told to the shell so its centre control adds to
  // the day being read rather than always to today.
  onDay: (date: string) => void
  // The scanner lives above this tab, so it is opened by asking for it, with
  // the day and the meal a scan should land on.
  onScan: (date: string, slot: Slot) => void
  // The numbers this day is read against are set one tab over, and the card
  // that shows them says so.
  onOpenTargets: () => void
}) {
  const todayIso = today(me.timezone)
  const [date, setDate] = useState(
    wantDate === undefined || wantDate === '' ? todayIso : wantDate
  )
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)
  const [picking, setPicking] = useState<Slot | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [exercising, setExercising] = useState(false)
  // The one workout this tab opens over itself, when a synced row is tapped.
  const [viewing, setViewing] = useState<number | null>(null)
  // A logged recipe or kept meal is edited by the serving, which is the only
  // thing about it that can change.
  const [servings, setServings] = useState<{ entry: DiaryEntry; slot: Slot } | null>(null)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState('')
  // The popup that asks before a day is closed. Closing it again is one tap
  // and asks nothing.
  const [confirming, setConfirming] = useState(false)
  // The day's vitamins and minerals, which are a panel of their own rather
  // than another fold inside the card.
  const [vitamins, setVitamins] = useState(false)
  const [marking, setMarking] = useState(false)

  // A day the member has closed. Nothing on it can be written until the check
  // is tapped again, and the server holds the same rule.
  const locked = day !== null && day.completed
  // Against what the body uses today, exercise included, rather than against
  // the target: on a fast goal rate a day over target is still a day under.
  const gap =
    day === null || day.energy === null
      ? null
      : Math.round(
          day.energy.resting +
            day.energy.activity +
            day.energy.exercise -
            (day.totals.calories ?? 0)
        )

  const toggleComplete = async () => {
    if (day === null || marking) return
    setMarking(true)
    setError('')
    try {
      if (locked) await api(`/diary/complete/${date}`, { method: 'DELETE' })
      else await api('/diary/complete', { method: 'PUT', body: { date } })
      setConfirming(false)
      setAgain(again + 1)
      onChanged?.()
    } catch (failure) {
      setError(errorText(failure))
    }
    setMarking(false)
  }

  // The day chooser is this tab's header, so the day is picked in one place
  // and the page below is only the day itself. The plus adds to the day on
  // screen, at the meal the hour makes likely, and goes while the day is shut.
  useTopBar(
    viewing !== null
      ? null
      : {
          title: dayLabel(date, todayIso),
          pager: {
            atToday: date >= todayIso,
            onStep: (days) => setDate(shiftDay(date, days)),
            onToday: () => setDate(todayIso),
          },
          mark: {
            done: locked,
            label: locked ? 'Open this day again' : 'Mark day as complete',
            onToggle: () => {
              if (locked) void toggleComplete()
              else setConfirming(true)
            },
          },
          action: locked
            ? undefined
            : {
                label: 'Add item',
                onAct: () => setPicking(slotByTime(me.timezone)),
              },
        }
  )

  // A write refused because this day was closed on another device. The message
  // is already on whichever sheet asked; this is the page catching up.
  useEffect(() => {
    const stale = () => setAgain((count) => count + 1)
    window.addEventListener(STALE, stale)
    return () => window.removeEventListener(STALE, stale)
  }, [])

  useEffect(() => onDay(date), [date, onDay])

  // A second send while this tab is already open. The day itself is not a
  // dependency: paging away from the day somebody arrived on must stick.
  useEffect(() => {
    if (wantDate !== undefined && wantDate !== '') setDate(wantDate)
  }, [wantDate])

  // A deletion waiting on its answer.
  const [asking, setAsking] = useState<Asking | null>(null)

  useEffect(() => {
    let alive = true
    api<DiaryDay>(`/diary/day?date=${date}`)
      .then((loaded) => alive && setDay(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [date, again, refresh])

  const reload = () => {
    setPicking(null)
    setEditing(null)
    setServings(null)
    setMeasuring(false)
    setExercising(false)
    setAgain(again + 1)
  }

  const openEntry = async (entry: DiaryEntry, slot: Slot) => {
    if (wholeThing(entry)) {
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

  const changeServings = async (amount: number | null, slot: Slot, follow: boolean) => {
    if (servings === null || amount === null) return
    setSaving(true)
    setRefusal('')
    // The flag is only meant on a row an auto-log wrote, where it says whether
    // the standing instruction moves with the day.
    const also = servings.entry.auto_log_id === null ? {} : { follow_auto_log: follow }
    try {
      await api(`/diary/${servings.entry.id}`, {
        method: 'PATCH',
        body: { amount, slot, ...also },
      })
      reload()
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  // The row goes off the screen and the request goes with it. A refusal is not
  // worth a message on a day somebody has moved on from; the next read tells
  // the truth.
  const remove = (asked: Asking) => {
    if (asked.kind === 'exercise') {
      setDay((current) => (current === null ? current : withoutExercise(current, asked.id)))
      api(`/health/exercise/${asked.id}`, { method: 'DELETE' }).catch(() => {})
      return
    }
    setEditing(null)
    setServings(null)
    setDay((current) => (current === null ? current : without(current, asked.entry)))
    api(`/diary/${asked.entry.id}`, { method: 'DELETE' }).catch(() => {})
  }

  const weighed = day?.measurement ?? null

  if (viewing !== null) {
    return (
      <WorkoutDetails
        me={me}
        workoutId={viewing}
        back="Journal"
        onBack={() => setViewing(null)}
        onChanged={onChanged}
      />
    )
  }

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      {locked && (
        <p className="mb-3 text-sm text-accent">
          Journal for {shortDate(date)} complete!
        </p>
      )}

      {day !== null && (
        <BreakdownCard
          energy={day.energy}
          gap={(day.totals.calories ?? 0) > 0 ? gap : null}
          tour="journal-top"
        >
          <div className="mb-1 flex items-center justify-between">
            <p className="t-micro">Remaining today</p>
            <button
              type="button"
              className="t-micro t-tap44 flex items-center gap-1"
              onClick={onOpenTargets}
            >
              Targets
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          </div>
          <span className="t-nums block text-3xl font-semibold leading-tight">
            {calText(day.remaining_calories)}
            <span className="ml-1 text-sm font-normal text-muted">cal</span>
          </span>
          <span className="block text-xs text-muted">
            {calText(day.totals.calories ?? 0)} consumed of{' '}
            {calText(day.budget.calories + day.exercise_kcal)}
          </span>
          {day.exercise_kcal > 0 && (
            <span className="block text-xs text-muted">
              Includes exercise added: +{day.exercise_kcal} cal
            </span>
          )}
          <div className="mt-4 flex flex-col gap-3">
            {HEADLINE.slice(1).map((fact) => (
              <MacroBar
                key={fact.key}
                label={fact.label}
                value={day.totals[fact.key]}
                target={day.budget[fact.key]}
                unit={fact.unit}
              />
            ))}
          </div>
        </BreakdownCard>
      )}

      {day !== null && (
        <button
          type="button"
          className="t-btn mb-3 w-full"
          onClick={() => setVitamins(true)}
        >
          View vitamins
        </button>
      )}

      {/* Every meal card is on the page from the start, empty or not, so the
          day reads the same shape every time and each meal has its own Add. */}
      {day !== null && (
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
              {day.slots[slot].entries.map((entry) => {
                const line = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{entry.name}</span>
                        {/* Written by a standing auto-log rather than logged
                            by hand. It is edited and deleted like any row. */}
                        {entry.auto_log_id !== null && <span className="t-chip shrink-0">Auto</span>}
                      </span>
                      {under(entry) && (
                        <span className="block truncate text-xs text-muted">{under(entry)}</span>
                      )}
                    </span>
                    <span className="t-nums shrink-0 text-sm">
                      {nutrientText('calories', entry.calories)}
                    </span>
                  </>
                )
                return locked ? (
                  <div key={entry.id} className="t-row">
                    {line}
                  </div>
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    className="t-row w-full text-left"
                    onClick={() => openEntry(entry, slot)}
                  >
                    {line}
                  </button>
                )
              })}
              {!locked && (
                <button
                  type="button"
                  className="t-row w-full text-left text-sm text-muted"
                  onClick={() => setPicking(slot)}
                >
                  + Add
                </button>
              )}
            </div>
          ))}
        </>
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
            <p className="text-sm text-muted">Nothing logged yet.</p>
          ) : (
            day.exercise.map((row) => {
              const line = (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <ActivityIcon name={row.name} className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{row.name}</span>
                    <span className="block text-xs text-muted">
                      {row.minutes} min
                      {row.kcal === null ? '' : ` · about ${row.kcal} cal`}
                      {row.source === 'manual' ? '' : ` · ${SOURCE_LABEL[row.source]}`}
                    </span>
                  </span>
                </span>
              )
              // A synced row opens the session it came from. Nothing to delete
              // there: a workout that arrived from a phone is corrected on the
              // phone, and this row follows what it sends.
              return row.workout_id !== null ? (
                <button
                  key={`w${row.workout_id}`}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => setViewing(row.workout_id as number)}
                >
                  {line}
                  <span className="shrink-0 text-xs text-muted">Synced</span>
                </button>
              ) : (
                <div key={row.id ?? row.name} className="t-row">
                  {line}
                  {!locked && (
                    <button
                      type="button"
                      className="t-tap44 shrink-0 text-sm text-muted"
                      onClick={() =>
                        setAsking({ kind: 'exercise', id: row.id as number, name: row.name })
                      }
                    >
                      Delete
                    </button>
                  )}
                </div>
              )
            })
          )}
          {!locked && (
            <button
              type="button"
              className="t-row w-full text-left text-sm text-muted"
              onClick={() => setExercising(true)}
            >
              + Add
            </button>
          )}
        </div>
      )}

      {day !== null && (
        <div className="t-card mb-3">
          <p className="t-micro mb-1">Biometrics</p>
          {weighed === null ? (
            <p className="text-sm text-muted">Nothing measured yet.</p>
          ) : (
            <>
              {weighed.weight_kg !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Weight</span>
                  <span className="t-nums">{weightText(weighed.weight_kg, me.units)}</span>
                </div>
              )}
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
              {weighed.muscle_pct !== null && (
                <div className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">Muscle</span>
                  {/* No weight on the day means no mass to show it as, so the
                      share stands on its own. */}
                  <span className="t-nums">
                    {weighed.muscle_kg === null
                      ? `${round1(weighed.muscle_pct)}%`
                      : weightText(weighed.muscle_kg, me.units)}
                  </span>
                </div>
              )}
            </>
          )}
          {!locked && (
            <button
              type="button"
              className="t-row w-full text-left text-sm text-muted"
              onClick={() => setMeasuring(true)}
            >
              {weighed === null ? '+ Log biometrics' : '+ Update'}
            </button>
          )}
        </div>
      )}

      {picking !== null && (
        <FoodPicker
          me={me}
          date={date}
          slot={picking}
          onClose={() => setPicking(null)}
          onLogged={reload}
          onScan={() => {
            const slot = picking
            setPicking(null)
            onScan(date, slot)
          }}
        />
      )}

      {vitamins && day !== null && (
        <VitaminsSheet
          micros={day.micros}
          day={dayLabel(date, todayIso)}
          onClose={() => setVitamins(false)}
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
          entry={editing.entry}
          onClose={() => setEditing(null)}
          onDone={reload}
          onDelete={(entry) => setAsking({ kind: 'food', entry })}
        />
      )}

      {servings !== null && (
        <LogSheet
          title="Edit"
          action="Save"
          name={servings.entry.name}
          servings={servings.entry.amount ?? 1}
          slot={servings.slot}
          // Whichever way it was logged is the way it is edited: a row already
          // in grams has no weight of the whole thing here to switch against.
          weighing={servings.entry.unit === 'g'}
          autoLogged={servings.entry.auto_log_id !== null}
          error={refusal}
          saving={saving}
          onClose={() => setServings(null)}
          onSubmit={(amount, slot, _byWeight, follow) => void changeServings(amount, slot, follow)}
          onDelete={() => setAsking({ kind: 'food', entry: servings.entry })}
        />
      )}

      <ConfirmSheet
        open={confirming}
        label="Mark day as complete?"
        question="Mark day as complete?"
        note={`This will lock ${
          date === todayIso ? "today's" : "this day's"
        } journal from further edits. You can always un-lock it again.`}
        verb="Mark complete"
        danger={false}
        busy={marking}
        onConfirm={() => void toggleComplete()}
        onClose={() => setConfirming(false)}
      />

      {/* Last, so it sits over the sheet a row is being edited in. */}
      <ConfirmSheet
        open={asking !== null}
        label="Delete entry"
        question={
          asking === null
            ? ''
            : `Delete ${asking.kind === 'food' ? asking.entry.name : asking.name} from ${dayLabel(
                date,
                todayIso
              )}?`
        }
        note={
          asking?.kind === 'exercise' ? 'Its minutes leave the day.' : 'Its calories leave the day.'
        }
        verb="Delete"
        onConfirm={() => {
          if (asking === null) return
          const asked = asking
          setAsking(null)
          remove(asked)
        }}
        onClose={() => setAsking(null)}
      />
    </>
  )
}
