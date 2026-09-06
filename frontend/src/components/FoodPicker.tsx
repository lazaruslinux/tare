import { ScanLine, Star, Zap } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Food, type FoodRow, type Me, type RepeatRow } from '../api'
import { slotByTime, today, type Slot } from '../lib/day'
import { BrowseList } from './BrowseList'
import { Calories, PhotoThumb, Verified, favoritesOf, subline } from './FoodRows'
import { PortionSheet } from './PortionSheet'
import { Sheet } from './Sheet'

// Long enough that typing a word is one request rather than five.
const DEBOUNCE = 250
const MIN_QUERY = 2

// How many results are on screen before the rest are one tap away. A list
// somebody has to scroll past to reach anything is a list nobody reads.
// How many results land on the screen at once. A phone shows a handful and
// offers the rest a tap away; a desktop has the room to show a page.
const ROOMY = '(min-width: 900px)'
function pageSize(): number {
  return window.matchMedia(ROOMY).matches ? 30 : 6
}

// What the box is for, in the words of the thing being looked for. The heading
// above it says which screen this is; this says what to type.
const SEARCH_HINT = 'Search items, like Great Value cheese'

// A typed field as a number, or nothing. An empty box is a figure nobody gave,
// which is not the same as zero of it.
function num(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

// The same, rounded: a quick add is somebody reading a number off a packet, and
// Tare states every one of them whole.
function whole(raw: string): number | null {
  const value = num(raw)
  return value === null ? null : Math.round(value)
}

function Row({ row, onOpen }: { row: FoodRow & { pinned?: boolean }; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <PhotoThumb row={row} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {row.pinned && (
            <Star
              className="h-3 w-3 shrink-0 text-accent"
              strokeWidth={2.5}
              fill="currentColor"
            />
          )}
          <span className="truncate text-sm">{row.name}</span>
          {row.status === 'approved' && <Verified />}
        </span>
        {subline(row) && (
          <span className="block truncate text-xs text-muted">{subline(row)}</span>
        )}
      </span>
      <Calories row={row} />
    </button>
  )
}

// The last resort: something eaten that is not in the database and is not worth
// putting there. A name and a number, and whatever else somebody happens to
// know, logged and forgotten.
function QuickAdd({
  date,
  slot,
  onCancel,
  onLogged,
}: {
  date: string
  slot: Slot
  onCancel: () => void
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
          calories: whole(panel.calories),
          protein_g: whole(panel.protein_g),
          carbs_g: whole(panel.carbs_g),
          fat_g: whole(panel.fat_g),
        },
      })
      onLogged()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet center open label="Quick add" onClose={onCancel}>
      <form onSubmit={submit}>
        <p className="mb-3 text-base font-semibold tracking-tight">Quick add</p>

        <div className="mb-3">
          <label className="t-label" htmlFor="quick-name">
            Item name
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
            inputMode="numeric"
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
              inputMode="numeric"
              value={panel[key]}
              onChange={(event) => set(key, event.target.value)}
            />
          </div>
        ))}
        <p className="mt-2 text-xs text-muted">
          Quick add only logs a journal entry and is not added to My foods.
        </p>

        {error && <p className="t-error mt-3">{error}</p>}

        <div className="mt-4 flex gap-3">
          <button className="t-btn t-btn-primary flex-1" type="submit" disabled={saving}>
            Log
          </button>
          <button className="t-btn" type="button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  )
}

export function FoodPicker({
  me,
  date,
  slot,
  onClose,
  onLogged,
  onPick,
  onScan,
  browse,
}: {
  me: Me
  // The day and the meal a food is being logged into. Left out when nothing is
  // being logged, which is what onPick means.
  date?: string
  slot?: Slot
  onClose: () => void
  onLogged?: () => void
  // The camera, which lives above this sheet. Offered here because a package in
  // somebody's hand is faster to scan than to spell.
  onScan?: () => void
  // Given instead when a food is being chosen for a recipe or a kept meal. The
  // portion is handed back and nothing is written to the diary.
  onPick?: (food: Food, amount: number, unit: string) => void
  // Given instead when this is the Food page's way into the shared database.
  // A row opens the food's own page rather than a portion to log, and before
  // anybody types the sheet is the database itself, read by letter and aisle.
  browse?: {
    refresh: number
    onOpen: (id: number) => void
    onScan: () => void
  }
}) {
  const day = date ?? today(me.timezone)
  const meal = slot ?? slotByTime(me.timezone)
  // Whether this sheet is the Food page's way into the shared database, which
  // decides what a row does and what sits under the box before anybody types.
  const browsing = browse !== undefined
  const [query, setQuery] = useState('')
  // Null is not an empty result: it is a box nobody has typed two letters into.
  const [results, setResults] = useState<FoodRow[] | null>(null)
  const [repeat, setRepeat] = useState<RepeatRow[]>([])
  const [chosen, setChosen] = useState<Food | null>(null)
  const [quick, setQuick] = useState(false)
  const [error, setError] = useState('')
  // How many results are drawn. Back to the first page whenever the results
  // are a different question's answer.
  const [shown, setShown] = useState(pageSize)

  useEffect(() => {
    // Not asked for when the sheet is the shared database: nothing there shows
    // the favorites or the lately eaten.
    if (browsing) return
    let alive = true
    api<RepeatRow[]>('/foods/repeat')
      .then((rows) => alive && setRepeat(rows))
      .catch(() => alive && setRepeat([]))
    return () => {
      alive = false
    }
  }, [browsing])

  useEffect(() => {
    const needle = query.trim()
    setShown(pageSize())
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

  // What this sheet is, in one phrase, used as its name and above its box.
  const title = browsing ? 'Search Tare database' : onPick ? 'Choose a food' : 'Add to Journal'
  // A food typed in by hand is logged and forgotten, so there is nothing in it
  // to put in a recipe or a kept meal, and nothing to look up.
  const quickable = !onPick && !browsing
  // The starred foods, and under them the ones lately eaten that are not
  // already starred.
  const favorites = favoritesOf(repeat)
  const recent = repeat.filter((row) => !row.pinned)

  return (
    <>
      <Sheet open top tall={browsing} wide={browsing} label={title} onClose={onClose}>
        <p className="t-micro mb-2">{title}</p>
        <input
          className="t-input mb-3"
          type="search"
          placeholder={SEARCH_HINT}
          aria-label={title}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />

        {error && <p className="t-error mb-3">{error}</p>}

        {results !== null ? (
          results.length === 0 ? (
            <p className="text-sm text-muted">Nothing here goes by that name.</p>
          ) : (
            <>
              {/* Two columns where there is room for two: a list somebody is
                  looking a name up in reads across as well as down. */}
              <div className={browsing ? 'min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-x-6' : ''}>
                {results.slice(0, shown).map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    onOpen={() => (browse ? browse.onOpen(row.id) : open(row.id))}
                  />
                ))}
              </div>
              {results.length > shown && (
                <button
                  type="button"
                  className="t-btn mt-3 w-full"
                  onClick={() => setShown(shown + pageSize())}
                >
                  Show more
                </button>
              )}
            </>
          )
        ) : browse ? (
          // Nothing typed yet, so the sheet is the shared database itself.
          <BrowseList refresh={browse.refresh} onOpen={browse.onOpen} onScan={browse.onScan} />
        ) : favorites.length === 0 && recent.length === 0 ? (
          <p className="text-sm text-muted">
            The foods you favorite and the ones you log will show up here.
          </p>
        ) : (
          <>
            {favorites.length > 0 && (
              <>
                <p className="t-micro mb-1">Favorites</p>
                {favorites.map((row) => (
                  <Row key={row.id} row={row} onOpen={() => open(row.id)} />
                ))}
              </>
            )}
            {recent.length > 0 && (
              <>
                <p className="t-micro mt-3 mb-1">Recently used</p>
                {recent.map((row) => (
                  <Row key={row.id} row={row} onOpen={() => open(row.id)} />
                ))}
              </>
            )}
          </>
        )}

        {/* The two ways past a database that does not have it: the packet in
            somebody's hand, or the numbers off it typed once. */}
        {(onScan || quickable) && (
          <div className="mt-3 flex gap-3">
            {onScan && (
              <button type="button" className="t-btn flex-1" onClick={onScan}>
                <ScanLine className="h-4 w-4" strokeWidth={2} />
                Scan item
              </button>
            )}
            {quickable && (
              <button type="button" className="t-btn flex-1" onClick={() => setQuick(true)}>
                <Zap className="h-4 w-4" strokeWidth={2} />
                Quick add
              </button>
            )}
          </div>
        )}
      </Sheet>

      {quick && (
        <QuickAdd
          date={day}
          slot={meal}
          onCancel={() => setQuick(false)}
          onLogged={() => onLogged?.()}
        />
      )}
    </>
  )
}
