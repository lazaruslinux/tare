import { ChevronLeft, Pin } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Food, type FoodRow, type Me, type RepeatRow } from '../api'
import { slotByTime, today, type Slot } from '../lib/day'
import { PortionSheet } from './PortionSheet'
import { Sheet } from './Sheet'

// Long enough that typing a word is one request rather than five.
const DEBOUNCE = 250
const MIN_QUERY = 2

// A typed field as a number, or nothing. An empty box is a figure nobody gave,
// which is not the same as zero of it.
function num(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function Row({ row, onOpen }: { row: FoodRow & { pinned?: boolean }; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {row.pinned && <Pin className="h-3 w-3 shrink-0 text-accent" strokeWidth={2.5} />}
          <span className="truncate text-sm">{row.name}</span>
        </span>
        {row.brand && <span className="block truncate text-xs text-muted">{row.brand}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="t-nums block text-sm">
          {row.calories === null ? '-' : Math.round(row.calories)} cal
        </span>
        <span className="block text-xs text-muted">per 100 {row.base_unit}</span>
      </span>
    </button>
  )
}

// The last resort: something eaten that is not in the database and is not worth
// putting there. A name and a number, and whatever else somebody happens to
// know, logged and forgotten.
function QuickAdd({
  date,
  slot,
  onBack,
  onLogged,
}: {
  date: string
  slot: Slot
  onBack: () => void
  onLogged: () => void
}) {
  const [name, setName] = useState('')
  const [panel, setPanel] = useState({ calories: '', protein_g: '', carbs_g: '', fat_g: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const set = (key: keyof typeof panel, value: string) => setPanel({ ...panel, [key]: value })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/diary', {
        method: 'POST',
        body: {
          date,
          slot,
          name,
          calories: num(panel.calories),
          protein_g: num(panel.protein_g),
          carbs_g: num(panel.carbs_g),
          fat_g: num(panel.fat_g),
        },
      })
      onLogged()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Back
      </button>

      <div className="mb-3">
        <label className="t-label" htmlFor="quick-name">
          What was it
        </label>
        <input
          id="quick-name"
          className="t-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="t-row">
        <label className="flex-1 text-sm" htmlFor="quick-calories">
          Calories
        </label>
        <input
          id="quick-calories"
          className="t-input t-nums max-w-[40%] text-right"
          inputMode="decimal"
          value={panel.calories}
          onChange={(event) => set('calories', event.target.value)}
        />
      </div>
      {(['protein_g', 'carbs_g', 'fat_g'] as const).map((key, index) => (
        <div key={key} className="t-row">
          <label className="flex-1 text-sm" htmlFor={`quick-${key}`}>
            {['Protein', 'Carbs', 'Fat'][index]} <span className="text-muted">(g)</span>
          </label>
          <input
            id={`quick-${key}`}
            className="t-input t-nums max-w-[40%] text-right"
            inputMode="decimal"
            value={panel[key]}
            onChange={(event) => set(key, event.target.value)}
          />
        </div>
      ))}
      <p className="mt-2 text-xs text-muted">
        Only the name and the calories are needed. This is logged, not kept as a food.
      </p>

      {error && <p className="t-error mt-3">{error}</p>}

      <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={saving}>
        Log
      </button>
    </form>
  )
}

export function FoodPicker({
  me,
  date,
  slot,
  onClose,
  onLogged,
  onPick,
}: {
  me: Me
  // The day and the meal a food is being logged into. Left out when nothing is
  // being logged, which is what onPick means.
  date?: string
  slot?: Slot
  onClose: () => void
  onLogged?: () => void
  // Given instead when a food is being chosen for a recipe or a kept meal. The
  // portion is handed back and nothing is written to the diary.
  onPick?: (food: Food, amount: number, unit: string) => void
}) {
  const day = date ?? today(me.timezone)
  const meal = slot ?? slotByTime(me.timezone)
  const [query, setQuery] = useState('')
  // Null is not an empty result: it is a box nobody has typed two letters into.
  const [results, setResults] = useState<FoodRow[] | null>(null)
  const [repeat, setRepeat] = useState<RepeatRow[]>([])
  const [chosen, setChosen] = useState<Food | null>(null)
  const [quick, setQuick] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    api<RepeatRow[]>('/foods/repeat')
      .then((rows) => alive && setRepeat(rows))
      .catch(() => alive && setRepeat([]))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < MIN_QUERY) {
      setResults(null)
      return
    }
    const timer = window.setTimeout(() => {
      api<FoodRow[]>(`/foods/search?q=${encodeURIComponent(needle)}`)
        .then(setResults)
        .catch(() => setResults([]))
    }, DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [query])

  const open = async (id: number) => {
    setError('')
    try {
      setChosen(await api<Food>(`/foods/${id}`))
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  // One sheet at a time: picking a food replaces this with the portion it is
  // being logged at, and cancelling that comes back here.
  if (chosen !== null) {
    return (
      <PortionSheet
        food={chosen}
        date={day}
        slot={meal}
        units={me.units}
        onClose={() => setChosen(null)}
        onDone={() => onLogged?.()}
        onPick={onPick}
      />
    )
  }

  return (
    <Sheet open label={onPick ? 'Choose a food' : 'Add food'} onClose={onClose}>
      {quick ? (
        <QuickAdd
          date={day}
          slot={meal}
          onBack={() => setQuick(false)}
          onLogged={() => onLogged?.()}
        />
      ) : (
        <>
          <p className="t-micro mb-2">{onPick ? 'Choose a food' : 'Add food'}</p>
          <input
            className="t-input mb-3"
            type="search"
            placeholder="Search foods"
            aria-label="Search foods"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />

          {error && <p className="t-error mb-3">{error}</p>}

          {results !== null ? (
            results.length === 0 ? (
              <p className="text-sm text-muted">Nothing here goes by that name.</p>
            ) : (
              results.map((row) => <Row key={row.id} row={row} onOpen={() => open(row.id)} />)
            )
          ) : (
            <>
              <p className="t-micro mb-1">Repeat</p>
              {repeat.length === 0 ? (
                <p className="text-sm text-muted">
                  The foods you pin and the ones you log will be offered here.
                </p>
              ) : (
                repeat.map((row) => <Row key={row.id} row={row} onOpen={() => open(row.id)} />)
              )}
            </>
          )}

          {/* A quick add is logged and forgotten, so there is nothing in it to
              put in a recipe or a kept meal. */}
          {!onPick && (
            <button
              type="button"
              className="t-row w-full text-left text-sm text-muted"
              onClick={() => setQuick(true)}
            >
              Can&rsquo;t find it? Quick add
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}
