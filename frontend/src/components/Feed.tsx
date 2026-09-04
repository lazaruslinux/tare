import { ChevronRight, Route } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, type FeedJournal, type FeedPage, type FeedRow, type FeedWorkout, type Me } from '../api'
import { dayLabel, today } from '../lib/day'
import { distanceText, durationText } from '../lib/units'

// What the members of this instance are doing, read only. Two kinds of row:
// a workout somebody did, and a day somebody finished. No food, no weight, no
// answering back.

function timeText(iso: string, timezone: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    // A zone this browser has never heard of. The device's own is the next
    // best answer, and it is the one the person is standing in.
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
}

// The member's name, which is the one thing on a row that opens something.
function Name({ row, onOpenMember }: { row: FeedRow; onOpenMember: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="underline decoration-line underline-offset-2"
      onClick={(event) => {
        event.stopPropagation()
        onOpenMember()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onOpenMember()
      }}
    >
      {row.display_name}
    </span>
  )
}

// A finished day. Nothing to open: the row is the whole of what was shared.
function JournalRow({
  me,
  row,
  todayIso,
  onOpenMember,
}: {
  me: Me
  row: FeedJournal
  todayIso: string
  onOpenMember: () => void
}) {
  return (
    <div className="t-row">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <Name row={row} onOpenMember={onOpenMember} /> completed {row.pronoun} journal
        </span>
        <span className="block text-xs text-muted">
          {`${dayLabel(row.date, todayIso)} ${timeText(row.at, me.timezone)}`}
        </span>
      </span>
      {row.hidden === true && <span className="t-chip shrink-0">Only you</span>}
    </div>
  )
}

function Row({
  me,
  row,
  todayIso,
  onOpen,
  onOpenMember,
}: {
  me: Me
  row: FeedWorkout
  todayIso: string
  onOpen: () => void
  onOpenMember: () => void
}) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{row.activity}</span>
        <span className="block text-xs text-muted">
          <Name row={row} onOpenMember={onOpenMember} />
          {` · ${dayLabel(row.date, todayIso)} ${timeText(row.started_at, me.timezone)}`}
          {` · ${durationText(row.duration_s)}`}
          {row.distance_m === null ? '' : ` · ${distanceText(row.distance_m, me.units)}`}
        </span>
      </span>
      {row.hidden === true && <span className="t-chip shrink-0">Only you</span>}
      {row.has_route && <Route className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
    </button>
  )
}

export function Feed({
  me,
  limit,
  refresh,
  onOpenWorkout,
  onOpenMember,
}: {
  me: Me
  // How many rows a card shows. Without one this is the whole list, with the
  // button that reads the next page.
  limit?: number
  // The app-wide change tick. The rows stay up while it reads again.
  refresh: number
  onOpenWorkout: (id: number) => void
  onOpenMember: (userId: number) => void
}) {
  // Null is a list nobody has read yet, which is not the same as none.
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const todayIso = today(me.timezone)

  useEffect(() => {
    let alive = true
    api<FeedPage>('/feed')
      .then((page) => {
        if (!alive) return
        setRows(page.items)
        setCursor(page.next_cursor)
      })
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [refresh])

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    try {
      const page = await api<FeedPage>(`/feed?cursor=${encodeURIComponent(cursor)}`)
      setRows((seen) => [...(seen ?? []), ...page.items])
      setCursor(page.next_cursor)
    } catch {
      // Nothing is lost: what is on screen stays, and the button is still there.
    }
    setBusy(false)
  }

  if (rows === null) return <p className="text-sm text-muted">Loading.</p>
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing shared yet. Workouts and finished days appear here as members share them.
      </p>
    )
  }

  const shown = limit === undefined ? rows : rows.slice(0, limit)
  return (
    <>
      {shown.map((row) =>
        row.kind === 'journal' ? (
          <JournalRow
            key={`j${row.id}`}
            me={me}
            row={row}
            todayIso={todayIso}
            onOpenMember={() => onOpenMember(row.user_id)}
          />
        ) : (
          <Row
            key={`w${row.id}`}
            me={me}
            row={row}
            todayIso={todayIso}
            onOpen={() => onOpenWorkout(row.id)}
            onOpenMember={() => onOpenMember(row.user_id)}
          />
        )
      )}
      {limit === undefined && cursor !== null && (
        <button type="button" className="t-btn mt-3 w-full" disabled={busy} onClick={more}>
          Show more
        </button>
      )}
    </>
  )
}
