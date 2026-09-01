import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { api, errorText, type Food as FoodItem, type FoodRow } from '../api'
import { FoodForm } from '../components/FoodForm'
import { FoodDetail } from './FoodDetail'

// How many of your own foods the card shows before it offers the rest.
const SHOWN = 6
// Long enough that typing a word is one request rather than five.
const DEBOUNCE = 250
// How long a deleted food can be brought back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

// The rest of what this tab will hold. Each says what it is for and waits for
// the feature behind it; none of them pretends to be a button yet.
const LATER: { title: string; note: string }[] = [
  { title: 'Custom Meals', note: 'Groups of foods you eat together will be kept here.' },
  { title: 'Custom Recipes', note: 'Things you cook, with the numbers worked out, will be kept here.' },
  { title: 'Repeat Items', note: 'The foods you log again and again will collect here.' },
  { title: 'Browse database', note: 'The shared food database will be browsed from here.' },
]

type View = { at: 'list' } | { at: 'detail'; id: number } | { at: 'form'; food: FoodItem | null }

function Row({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{row.name}</span>
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

export function FoodTab() {
  const [view, setView] = useState<View>({ at: 'list' })
  const [foods, setFoods] = useState<FoodRow[]>([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  // Null is not an empty result: it is a box nobody has typed two letters into.
  const [results, setResults] = useState<FoodRow[] | null>(null)
  const [again, setAgain] = useState(0)

  // A deletion that has not happened yet. The row is gone from the screen and
  // the request is not sent until the window closes, so undoing is not a second
  // write to put back what a first one destroyed.
  const [pending, setPending] = useState<FoodRow | null>(null)
  const pendingRef = useRef<FoodRow | null>(null)

  const load = () =>
    api<FoodRow[]>('/foods/mine').then(setFoods, (failure) => setError(errorText(failure)))

  const erase = (id: number) => {
    pendingRef.current = null
    api(`/foods/${id}`, { method: 'DELETE' }).catch(() => {
      // The row is already off the screen. Saying so now, on a screen somebody
      // has moved on from, would be noise; the list tells the truth the next
      // time it is read.
    })
  }

  useEffect(() => {
    let alive = true
    api<FoodRow[]>('/foods/mine')
      .then((rows) => alive && setFoods(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setResults(null)
      return
    }
    const timer = window.setTimeout(() => {
      api<FoodRow[]>(`/foods/search?q=${encodeURIComponent(needle)}`)
        .then(setResults)
        .catch(() => setResults([]))
    }, DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [query, again])

  useEffect(() => {
    if (pending === null) return
    const timer = window.setTimeout(() => {
      erase(pending.id)
      setPending(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [pending])

  // Leaving the tab is the window closing. Anything still waiting is settled on
  // the way out rather than quietly forgotten.
  useEffect(
    () => () => {
      if (pendingRef.current !== null) erase(pendingRef.current.id)
    },
    []
  )

  const remove = (food: FoodItem) => {
    setFoods((rows) => rows.filter((row) => row.id !== food.id))
    setResults((rows) => (rows === null ? null : rows.filter((row) => row.id !== food.id)))
    setView({ at: 'list' })
    pendingRef.current = food
    setPending(food)
  }

  const undo = () => {
    pendingRef.current = null
    setPending(null)
    void load()
    setAgain(again + 1)
  }

  if (view.at === 'detail') {
    return (
      <FoodDetail
        id={view.id}
        onBack={() => setView({ at: 'list' })}
        onEdit={(food) => setView({ at: 'form', food })}
        onDelete={remove}
      />
    )
  }

  if (view.at === 'form') {
    const editing = view.food
    return (
      <FoodForm
        food={editing}
        onSaved={(saved) => {
          void load()
          setView({ at: 'detail', id: saved.id })
        }}
        onCancel={() =>
          setView(editing === null ? { at: 'list' } : { at: 'detail', id: editing.id })
        }
      />
    )
  }

  return (
    <>
      <p className="t-micro mb-2">Food</p>

      {foods.length > 0 && (
        <input
          className="t-input mb-3"
          type="search"
          placeholder="Search foods"
          aria-label="Search foods"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {error && <p className="t-error mb-3">{error}</p>}

      {results !== null ? (
        <div className="t-card mb-3">
          <p className="t-micro mb-1">Results</p>
          {results.length === 0 ? (
            <p className="text-sm text-muted">Nothing here goes by that name.</p>
          ) : (
            results.map((row) => (
              <Row key={row.id} row={row} onOpen={() => setView({ at: 'detail', id: row.id })} />
            ))
          )}
        </div>
      ) : (
        <>
          <div className="t-card mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="t-micro">Custom Foods</p>
              <button
                type="button"
                className="t-tap44 text-accent"
                aria-label="Add a food"
                onClick={() => setView({ at: 'form', food: null })}
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {foods.length === 0 ? (
              <p className="text-sm text-muted">Foods you enter yourself are kept here.</p>
            ) : (
              <>
                {(expanded ? foods : foods.slice(0, SHOWN)).map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    onOpen={() => setView({ at: 'detail', id: row.id })}
                  />
                ))}
                {foods.length > SHOWN && (
                  <button
                    type="button"
                    className="t-row w-full text-left text-sm text-muted"
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? 'Show fewer' : `See all ${foods.length}`}
                  </button>
                )}
              </>
            )}
          </div>

          {LATER.map((card) => (
            <div key={card.title} className="t-card mb-3">
              <p className="t-micro mb-1">{card.title}</p>
              <p className="text-sm text-muted">{card.note}</p>
            </div>
          ))}
        </>
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
