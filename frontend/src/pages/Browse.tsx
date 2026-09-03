import { useEffect, useRef, useState } from 'react'

import { api, errorText, type BrowsePage, type FoodRow } from '../api'
import { Calories, PhotoThumb } from '../components/FoodRows'
import { useTopBar } from '../hooks/useTopBar'

// The shared database, as a place to look something up rather than a wall to
// scroll. Three ways in, in the order somebody reaches for them: type the name,
// tap the letter it starts with, or read what is there.

// Long enough that typing a word is one request rather than five.
const DEBOUNCE = 250
const MIN_QUERY = 2

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Where the search box takes focus on its own. A phone would answer that with
// the keyboard over half the screen before anybody asked for it.
const ROOMY = '(min-width: 900px)'

function Row({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <PhotoThumb url={row.photo_url} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{row.name}</span>
        {row.brand && <span className="block truncate text-xs text-muted">{row.brand}</span>}
      </span>
      <Calories row={row} />
    </button>
  )
}

export function Browse({
  onBack,
  onOpen,
  onScan,
}: {
  onBack: () => void
  onOpen: (id: number) => void
  // The one thing worth doing when the database is empty: put something in it.
  onScan: () => void
}) {
  const [query, setQuery] = useState('')
  // Null is not an empty result: it is a box nobody has typed two letters into.
  const [results, setResults] = useState<FoodRow[] | null>(null)
  const [letter, setLetter] = useState('')
  // Null is a page nobody has read yet, which is not the same as none.
  const [rows, setRows] = useState<FoodRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLInputElement>(null)

  useTopBar({ title: 'Browse tare database', back: { label: 'Food', onBack } })

  useEffect(() => {
    if (window.matchMedia(ROOMY).matches) box.current?.focus()
  }, [])

  // The letter is the whole of the listing's identity, so changing it reads the
  // first page again rather than adding to what is on screen.
  useEffect(() => {
    let alive = true
    setRows(null)
    const asked = letter ? `/foods/browse?letter=${letter}` : '/foods/browse'
    api<BrowsePage>(asked)
      .then((page) => {
        if (!alive) return
        setRows(page.items)
        setCursor(page.next_cursor)
        setError('')
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [letter])

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

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    setError('')
    try {
      const asked = new URLSearchParams(letter ? { letter, cursor } : { cursor })
      const page = await api<BrowsePage>(`/foods/browse?${asked}`)
      // Added to what is on screen rather than replacing it: this is one long
      // list read downwards, not a set of numbered pages.
      setRows((seen) => [...(seen ?? []), ...page.items])
      setCursor(page.next_cursor)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>
      <input
        ref={box}
        className="t-input mb-3"
        type="search"
        placeholder="Search foods"
        aria-label="Search foods"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {results === null && (
        <div className="mb-3 flex gap-x-2 gap-y-4 overflow-x-auto min-[900px]:flex-wrap">
          {LETTERS.map((option) => (
            <button
              key={option}
              type="button"
              className="t-chip t-tap44 min-w-9 shrink-0 justify-center aria-pressed:border-accent aria-pressed:text-text"
              aria-pressed={letter === option}
              onClick={() => setLetter(letter === option ? '' : option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {error && <p className="t-error mb-3">{error}</p>}

      {results !== null ? (
        <div className="t-card mb-3">
          {results.length === 0 ? (
            <p className="text-sm text-muted">Nothing here goes by that name.</p>
          ) : (
            results.map((row) => <Row key={row.id} row={row} onOpen={() => onOpen(row.id)} />)
          )}
        </div>
      ) : (
        <>
          {rows !== null && rows.length === 0 && (
            <div className="t-card mb-3">
              {letter ? (
                <p className="text-sm text-muted">Nothing shared starts with {letter} yet.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted">Nothing shared yet.</p>
                  <button type="button" className="t-btn w-full" onClick={onScan}>
                    Scan a food
                  </button>
                </>
              )}
            </div>
          )}

          {rows !== null && rows.length > 0 && (
            <div className="t-card mb-3">
              {rows.map((row) => (
                <Row key={row.id} row={row} onOpen={() => onOpen(row.id)} />
              ))}
            </div>
          )}

          {cursor !== null && (
            <button type="button" className="t-btn mb-3 w-full" disabled={busy} onClick={more}>
              Show more
            </button>
          )}
        </>
      )}
    </>
  )
}
