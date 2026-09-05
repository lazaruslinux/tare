import { useEffect, useState } from 'react'

import { api, errorText, type BrowsePage, type FoodRow } from '../api'
import { SECTIONS, sectionLabel } from '../lib/community'
import { FoodLine } from './FoodRows'

// The shared database as a place to read rather than a wall to scroll. It is
// what the search sheet shows before anybody types: tap the letter a food
// starts with, or the aisle it is in, or just read what is there.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// The aisle somebody was last reading is remembered per device: a person who
// shops the freezer comes back to the freezer.
const SECTION_KEY = 'tare.browse.section'

function rememberedSection(): string {
  try {
    const kept = window.localStorage.getItem(SECTION_KEY)
    return SECTIONS.some((row) => row.slug === kept) ? (kept as string) : ''
  } catch {
    return ''
  }
}

export function BrowseList({
  refresh,
  onOpen,
  onScan,
}: {
  // The app-wide change tick. A food approved while this was open belongs on
  // the list, and reading it again is invisible: the rows stay up meanwhile.
  refresh: number
  onOpen: (id: number) => void
  // The one thing worth doing when the database is empty: put something in it.
  onScan: () => void
}) {
  const [letter, setLetter] = useState('')
  // Empty is every aisle, which is the list as it was before sections.
  const [section, setSectionState] = useState(rememberedSection)
  // Null is a page nobody has read yet, which is not the same as none.
  const [rows, setRows] = useState<FoodRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const setSection = (slug: string) => {
    setSectionState(slug)
    try {
      window.localStorage.setItem(SECTION_KEY, slug)
    } catch {
      // A browser that refuses storage still gets the aisle it picked.
    }
  }

  // The letter and the aisle are the whole of the listing's identity, so
  // changing either empties the screen before the first page of the new one
  // lands. A refresh tick is not a new listing, so it leaves what is up alone
  // while it reads.
  useEffect(() => {
    setRows(null)
  }, [letter, section])

  useEffect(() => {
    let alive = true
    const asked = new URLSearchParams()
    if (letter) asked.set('letter', letter)
    if (section) asked.set('section', section)
    const query = asked.toString()
    api<BrowsePage>(query ? `/foods/browse?${query}` : '/foods/browse')
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
  }, [letter, section, refresh])

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    setError('')
    try {
      const asked = new URLSearchParams({ cursor })
      if (letter) asked.set('letter', letter)
      if (section) asked.set('section', section)
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
      <div className="t-strip mb-3">
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

      <div className="t-strip mb-3">
        {[{ slug: '', label: 'All' }, ...SECTIONS].map((option) => (
          <button
            key={option.slug || 'all'}
            type="button"
            className="t-chip t-tap44 shrink-0 aria-pressed:border-accent aria-pressed:text-text"
            aria-pressed={section === option.slug}
            onClick={() => setSection(option.slug)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error && <p className="t-error mb-3">{error}</p>}

      {rows !== null && rows.length === 0 && (
        <div className="t-card mb-3">
          {section && letter ? (
            <p className="text-sm text-muted">
              Nothing in {sectionLabel(section)} starts with {letter} yet.
            </p>
          ) : section ? (
            <p className="text-sm text-muted">Nothing in {sectionLabel(section)} yet.</p>
          ) : letter ? (
            <p className="text-sm text-muted">Nothing shared starts with {letter} yet.</p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">Nothing shared yet.</p>
              <button type="button" className="t-btn w-full" onClick={onScan}>
                Scan a barcode
              </button>
            </>
          )}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="t-card mb-3">
          {rows.map((row) => (
            <FoodLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))}
        </div>
      )}

      {cursor !== null && (
        <button type="button" className="t-btn mb-3 w-full" disabled={busy} onClick={more}>
          Show more
        </button>
      )}
    </>
  )
}
