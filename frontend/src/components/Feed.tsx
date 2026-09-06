import { ArrowDown, BookCheck, ChevronRight, CircleCheck } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  type FeedJournal,
  type FeedPage,
  type FeedRow,
  type FeedWeight,
  type FeedWorkout,
  type Me,
} from '../api'
import { ActivityIcon } from './ActivityIcon'
import { clockText, dateText, useClock } from '../lib/clock'
import { dayLabel, today } from '../lib/day'
import { distanceCompact, hmsText, weightCompact } from '../lib/units'

// What the members of this instance are doing, read only. Three kinds of row:
// a workout somebody did, a day somebody finished, and a weigh-in that came in
// lower. No food, no answering back.

// The two nearest days keep their words. Anything older is the stamp the rest
// of the app writes a date in.
function dayText(iso: string, todayIso: string): string {
  const said = dayLabel(iso, todayIso)
  return said === 'Today' || said === 'Yesterday' ? said : dateText(iso)
}

const JOURNAL_DONE = 'Journal complete'

// Every row has the same skeleton: the kind's icon at the left, then the
// member's name, a colon and the fact as one line of inline text, then the
// stamp. Inline, so a narrow column wraps the line like a sentence instead of
// clipping the distance and the time; each item is one unbreakable piece (the
// check with the activity, a distance, a time), so a wrap only ever falls
// between items.

// The member's name, which is the one thing on a row that opens something.
// Weight and the accent colour make it the anchor every row starts from.
function Name({ row, onOpenMember }: { row: FeedRow; onOpenMember: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      className="font-medium text-accent"
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
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <BookCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <Name row={row} onOpenMember={onOpenMember} />: {JOURNAL_DONE}
          </span>
          <span className="block text-xs text-muted">
            {dayText(row.date, todayIso)} {clockText(row.at, me.timezone)}
          </span>
        </span>
      </span>
      {row.hidden === true && <span className="t-chip shrink-0">Only you</span>}
    </div>
  )
}

// A weigh-in that came in under the one before it. How much came off, in the
// reader's own units, and nothing either weight was.
function WeightRow({
  me,
  row,
  todayIso,
  onOpenMember,
}: {
  me: Me
  row: FeedWeight
  todayIso: string
  onOpenMember: () => void
}) {
  return (
    <div className="t-row">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ArrowDown className="h-4 w-4 shrink-0 text-orange" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <Name row={row} onOpenMember={onOpenMember} />: {weightCompact(row.lost_kg, me.units)}{' '}
            <span className="whitespace-nowrap">since last weigh-in</span>
          </span>
          <span className="block text-xs text-muted">
            {dayText(row.date, todayIso)} {clockText(row.at, me.timezone)}
          </span>
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
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ActivityIcon name={row.activity} className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <Name row={row} onOpenMember={onOpenMember} />:{' '}
            <span>
              <span className="whitespace-nowrap">
                <CircleCheck
                  className="inline h-4 w-4 align-[-3px] text-blue"
                  strokeWidth={2}
                  aria-hidden="true"
                />{' '}
                <span className="text-blue">{row.activity}</span>
              </span>
              {row.distance_m !== null && (
                <>
                  {' '}
                  <span className="whitespace-nowrap">
                    - {distanceCompact(row.distance_m, me.units)}
                  </span>
                </>
              )}{' '}
              <span className="whitespace-nowrap">- {hmsText(row.duration_s)}</span>
            </span>
          </span>
          <span className="block text-xs text-muted">
            {dayText(row.date, todayIso)} {clockText(row.started_at, me.timezone)}
          </span>
        </span>
      </span>
      {row.hidden === true && <span className="t-chip shrink-0">Only you</span>}
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
  // Every row carries a time, so the whole list redraws when the preference
  // behind them moves.
  useClock()

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
        Nothing shared yet. Workouts, finished days and weigh-ins appear here as members share
        them.
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
        ) : row.kind === 'weight' ? (
          <WeightRow
            key={`s${row.id}`}
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
