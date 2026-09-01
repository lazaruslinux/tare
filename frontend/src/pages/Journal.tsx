import { ChevronLeft, ChevronRight } from 'lucide-react'
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
import { FoodPicker } from '../components/FoodPicker'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { SLOTS, SLOT_LABEL, dayLabel, shiftDay, slotByTime, today, type Slot } from '../lib/day'
import { portionText } from '../lib/units'

// How long a deleted entry can be brought back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

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
  return { ...day, totals, slots }
}

// The brand and the portion, whichever of them there is.
const under = (entry: DiaryEntry) => [entry.brand, portionText(entry)].filter(Boolean).join(' · ')

type Editing = { entry: DiaryEntry; food: Food | null; slot: Slot }

export function Journal({ me, refresh }: { me: Me; refresh: number }) {
  const todayIso = today(me.timezone)
  const [date, setDate] = useState(todayIso)
  const [day, setDay] = useState<DiaryDay | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)
  const [picking, setPicking] = useState<Slot | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)

  // A deletion that has not happened yet.
  const [pending, setPending] = useState<DiaryEntry | null>(null)
  const pendingRef = useRef<DiaryEntry | null>(null)

  const erase = (id: number) => {
    pendingRef.current = null
    api(`/diary/${id}`, { method: 'DELETE' }).catch(() => {
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
      erase(pending.id)
      setPending(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [pending])

  // Leaving the page is the window closing. Anything still waiting is settled
  // on the way out rather than quietly forgotten.
  useEffect(
    () => () => {
      if (pendingRef.current !== null) erase(pendingRef.current.id)
    },
    []
  )

  const reload = () => {
    setPicking(null)
    setEditing(null)
    setAgain(again + 1)
  }

  const openEntry = async (entry: DiaryEntry, slot: Slot) => {
    let food: Food | null = null
    if (entry.food_id !== null) {
      // A food that has since gone leaves the entry standing, and it is edited
      // as what it is: a portion and the numbers that survived it.
      food = await api<Food>(`/foods/${entry.food_id}`).catch(() => null)
    }
    setEditing({ entry, food, slot })
  }

  const remove = (entry: DiaryEntry) => {
    setEditing(null)
    setDay((current) => (current === null ? current : without(current, entry)))
    pendingRef.current = entry
    setPending(entry)
  }

  const undo = () => {
    pendingRef.current = null
    setPending(null)
    setAgain(again + 1)
  }

  const empty = day !== null && SLOTS.every((slot) => day.slots[slot].entries.length === 0)

  return (
    <>
      <p className="t-micro mb-2">Journal</p>

      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          className="t-tap44 text-muted"
          aria-label="Previous day"
          onClick={() => setDate(shiftDay(date, -1))}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
        </button>
        <p className="text-sm font-semibold">{dayLabel(date, todayIso)}</p>
        <button
          type="button"
          className="t-tap44 text-muted disabled:opacity-30"
          aria-label="Next day"
          disabled={date >= todayIso}
          onClick={() => setDate(shiftDay(date, 1))}
        >
          <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      {error && <p className="t-error mb-3">{error}</p>}

      {day !== null && empty && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing logged yet. Add your first food.</p>
          <button
            type="button"
            className="t-btn t-btn-primary mt-3 w-full"
            onClick={() => setPicking(slotByTime(me.timezone))}
          >
            Add food
          </button>
        </div>
      )}

      {day !== null && !empty && (
        <>
          <div className="t-card mb-3">
            <p className="t-micro mb-1">Eaten</p>
            <span className="t-nums block text-3xl font-semibold leading-tight">
              {nutrientText('calories', day.totals.calories)}
            </span>
            <span className="block text-xs text-muted">Calories</span>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {HEADLINE.slice(1).map((fact) => (
                <div key={fact.key}>
                  <span className="t-nums block text-sm font-semibold">
                    {nutrientText(fact.key, day.totals[fact.key])}
                    <span className="font-normal text-muted">{fact.unit}</span>
                  </span>
                  <span className="block text-xs text-muted">{fact.label}</span>
                </div>
              ))}
            </div>
          </div>

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

      {picking !== null && (
        <FoodPicker
          me={me}
          date={date}
          slot={picking}
          onClose={() => setPicking(null)}
          onLogged={reload}
        />
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
