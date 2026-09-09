import { ArrowDown, BookCheck, ChevronRight, CircleCheck, Hand, Lock } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  type FeedJoined,
  type FeedJournal,
  type FeedPage,
  type FeedRow,
  type FeedWeight,
  type FeedWorkout,
  type Me,
} from '../api'
import { ActivityIcon } from './ActivityIcon'
import { Sheet } from './Sheet'
import { clockText, dateText, useClock } from '../lib/clock'
import { dayLabel, dayOf, today } from '../lib/day'
import { weightCompact } from '../lib/units'

// What this account's friends are doing, read only. Four kinds of row: a
// workout somebody did, a day somebody finished, a weigh-in that came in
// lower, and somebody arriving. No food, no answering back.

// The two nearest days keep their words. Anything older is the stamp the rest
// of the app writes a date in.
function dayText(iso: string, todayIso: string): string {
  const said = dayLabel(iso, todayIso)
  return said === 'Today' || said === 'Yesterday' ? said : dateText(iso)
}

const JOURNAL_DONE = 'Journal complete'

// A row nobody else can see, and what saying so looks like: a small lock in
// the colour the app warns in, and a sheet with the one sentence behind it.
// The lock is on the row rather than in it, so tapping it never opens the
// workout the row is a way to.
function PrivateLock({ onOpen }: { onOpen: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Private"
      className="shrink-0 text-over"
      onClick={(event) => {
        event.stopPropagation()
        onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        onOpen()
      }}
    >
      <Lock className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </span>
  )
}

function PrivateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} label="Private" center onClose={onClose}>
      <p className="text-base font-semibold">Private</p>
      <p className="mt-2 text-sm text-muted">Only you can see this.</p>
      <button type="button" className="t-btn mt-4 w-full" onClick={onClose}>
        Close
      </button>
    </Sheet>
  )
}

// Every row has the same skeleton: the kind's icon at the left, then the
// member's name and the fact as one line of inline text, then the stamp.
// Inline, so a narrow column wraps the line like a sentence; each item is one
// unbreakable piece, so a wrap only ever falls between items.

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
  onPrivate,
}: {
  me: Me
  row: FeedJournal
  todayIso: string
  onOpenMember: () => void
  onPrivate: () => void
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
            {dayText(row.date, todayIso)} · {clockText(row.at, me.timezone)}
          </span>
        </span>
      </span>
      {row.hidden === true && <PrivateLock onOpen={onPrivate} />}
    </div>
  )
}

// A member arriving. Nothing to open and nothing to hide: it says they are
// here, and that they are welcome.
function JoinedRow({
  me,
  row,
  todayIso,
  onOpenMember,
}: {
  me: Me
  row: FeedJoined
  todayIso: string
  onOpenMember: () => void
}) {
  return (
    <div className="t-row">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Hand className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <Name row={row} onOpenMember={onOpenMember} /> joined Tare. Welcome!
          </span>
          {/* Arriving is a moment, not a day of theirs: the day is read in the
              reader's zone, the same one the clock beside it uses. */}
          <span className="block text-xs text-muted">
            {dayText(dayOf(me.timezone, row.at), todayIso)} · {clockText(row.at, me.timezone)}
          </span>
        </span>
      </span>
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
  onPrivate,
}: {
  me: Me
  row: FeedWeight
  todayIso: string
  onOpenMember: () => void
  onPrivate: () => void
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
            {dayText(row.date, todayIso)} · {clockText(row.at, me.timezone)}
          </span>
        </span>
      </span>
      {row.hidden === true && <PrivateLock onOpen={onPrivate} />}
    </div>
  )
}

function Row({
  me,
  row,
  todayIso,
  onOpen,
  onOpenMember,
  onPrivate,
}: {
  me: Me
  row: FeedWorkout
  todayIso: string
  onOpen: () => void
  onOpenMember: () => void
  onPrivate: () => void
}) {
  // The line is the same either way; only whether the row is a way in changes.
  const said = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <ActivityIcon name={row.activity} className="h-4 w-4 shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <Name row={row} onOpenMember={onOpenMember} />{' '}
            <span className="text-muted">synced:</span>{' '}
            <span className="whitespace-nowrap">
              <CircleCheck
                className="inline h-4 w-4 align-[-3px] text-blue"
                strokeWidth={2}
                aria-hidden="true"
              />{' '}
              <span className="text-blue">{row.activity}</span>
            </span>
          </span>
          <span className="block text-xs text-muted">
            {dayText(row.date, todayIso)} · {clockText(row.started_at, me.timezone)}
          </span>
        </span>
      </span>
      {row.hidden === true && <PrivateLock onOpen={onPrivate} />}
    </>
  )
  // A member who keeps their workout details to themselves shares the row and
  // nothing under it, so there is no chevron and nothing to tap.
  if (!row.open) return <div className="t-row">{said}</div>
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      {said}
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
  // What the lock on one of your own rows says. One sheet for the whole list:
  // it says the same thing whichever lock opened it.
  const [askedPrivate, setAskedPrivate] = useState(false)
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
        Nothing shared yet. Workouts, finished days and weigh-ins appear here as your friends
        share them.
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
            onPrivate={() => setAskedPrivate(true)}
          />
        ) : row.kind === 'weight' ? (
          <WeightRow
            key={`s${row.id}`}
            me={me}
            row={row}
            todayIso={todayIso}
            onOpenMember={() => onOpenMember(row.user_id)}
            onPrivate={() => setAskedPrivate(true)}
          />
        ) : row.kind === 'joined' ? (
          <JoinedRow
            key={`m${row.id}`}
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
            onPrivate={() => setAskedPrivate(true)}
          />
        )
      )}
      {limit === undefined && cursor !== null && (
        <button type="button" className="t-btn mt-3 w-full" disabled={busy} onClick={more}>
          Show more
        </button>
      )}
      <PrivateSheet open={askedPrivate} onClose={() => setAskedPrivate(false)} />
    </>
  )
}
