import { useEffect, useState } from 'react'

import { api, errorText, type BrowsePage, type FoodRow } from '../api'
import { useTopBar } from '../hooks/useTopBar'

// The shared database, as a wall of what is in it. Photographed foods come
// first because a picture is what somebody recognises a packet by, and the
// rest follow in the order they were approved.

// A food with no picture still needs a shape on the grid. Its first letter is
// enough to tell one tile from its neighbour while reading the names.
function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}

function Tile({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="text-left" onClick={onOpen}>
      {row.photo_url ? (
        <img
          src={row.photo_url}
          alt=""
          className="mb-2 aspect-square w-full rounded-xl border border-line object-cover"
        />
      ) : (
        <span className="mb-2 flex aspect-square w-full items-center justify-center rounded-xl border border-line bg-surface-2 text-3xl font-semibold text-muted">
          {initial(row.name)}
        </span>
      )}
      <span className="block truncate text-sm">{row.name}</span>
      <span className="block truncate text-xs text-muted">{row.brand || 'No brand'}</span>
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
  // Null is a page nobody has read yet, which is not the same as none.
  const [rows, setRows] = useState<FoodRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useTopBar({ title: 'Browse database', back: { label: 'Food', onBack } })

  const address = (marker: string | null) =>
    marker === null ? '/foods/browse' : `/foods/browse?cursor=${encodeURIComponent(marker)}`

  useEffect(() => {
    let alive = true
    api<BrowsePage>('/foods/browse')
      .then((page) => {
        if (!alive) return
        setRows(page.items)
        setCursor(page.next_cursor)
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    setError('')
    try {
      const page = await api<BrowsePage>(address(cursor))
      // Added to what is on screen rather than replacing it: this is one long
      // wall read downwards, not a set of numbered pages.
      setRows((seen) => [...(seen ?? []), ...page.items])
      setCursor(page.next_cursor)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      {rows !== null && rows.length === 0 && (
        <div className="t-card mb-3">
          <p className="mb-3 text-sm text-muted">Nothing shared yet.</p>
          <button type="button" className="t-btn w-full" onClick={onScan}>
            Scan a food
          </button>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4 min-[1200px]:grid-cols-5">
          {rows.map((row) => (
            <Tile key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))}
        </div>
      )}

      {cursor !== null && (
        <button type="button" className="t-btn mt-3 w-full" disabled={busy} onClick={more}>
          Show more
        </button>
      )}
    </>
  )
}
