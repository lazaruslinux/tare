import { useEffect, useState } from 'react'

import {
  api,
  type Me,
  type ReviewLogPage,
  type ReviewLogRow,
  type TodayStrip,
} from '../api'
import { useAsideSlotNode } from '../lib/asideSlot'
import { dayLabel, today } from '../lib/day'
import { reviews } from '../lib/roles'
import { weightText } from '../lib/units'
import { type Screen } from '../pages/More'
import { sentence } from '../pages/ReviewLog'
import { MiniMonth } from './calendar/MiniMonth'
import { Feed } from './Feed'
import { type Page } from './TabBar'

// The right-hand column: where today stands, and what the other members have
// been doing. The Dashboard already says today's numbers in its own cards, so
// on that tab the top block is the month instead; every other tab keeps the
// figures, and nothing on the column is said twice on one screen. A screen
// with something of its own to put there fills the slot, and that wins. On the
// screens somebody reviews from, the column is about the reviewing instead:
// their own calories and the feed are not what they are there for.

// The screens under More that are reviewing work rather than account settings.
const REVIEW_SCREENS: Screen[] = [
  'queue',
  'reviewlog',
  'micromatches',
  'uploads',
  'invites',
  'roles',
  'users',
  'feedbacklog',
]

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="t-micro mb-0.5">{label}</p>
      <p className="t-nums text-sm">{value}</p>
      {note !== undefined && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

// How much is left to judge, in the words the queue itself uses.
function waitingText(count: number): string {
  return count === 1 ? '1 waiting' : `${count} waiting`
}

// What the column is for while somebody is reviewing: what is still waiting,
// and for an administrator the last decisions anybody made.
function Reviewing({
  me,
  queue,
  // Already on the queue, so the figure says the number and leads nowhere.
  atQueue,
  refresh,
  onOpenMore,
}: {
  me: Me
  queue: number
  atQueue: boolean
  refresh: number
  onOpenMore: (screen: Screen) => void
}) {
  const [log, setLog] = useState<ReviewLogRow[] | null>(null)

  useEffect(() => {
    if (!me.is_admin) return
    let alive = true
    api<ReviewLogPage>('/admin/review-log')
      .then((page) => alive && setLog(page.items.slice(0, 5)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [refresh, me.is_admin])

  const figure = <span className="t-nums min-w-0 flex-1 text-sm">{waitingText(queue)}</span>

  return (
    <>
      <div>
        <p className="t-micro mb-2">Reviewing</p>
        <div className="t-card">
          {queue > 0 && !atQueue ? (
            <button
              type="button"
              className="t-row w-full text-left"
              onClick={() => onOpenMore('queue')}
            >
              {figure}
            </button>
          ) : (
            <div className="t-row">{figure}</div>
          )}
        </div>
      </div>

      {/* Everybody's decisions are the instance's own business, so only an
          administrator is shown them. */}
      {me.is_admin && (
        <div>
          <p className="t-micro mb-2">Recent decisions</p>
          <div className="t-card">
            {log === null ? null : log.length === 0 ? (
              <p className="text-sm text-muted">No decisions yet.</p>
            ) : (
              log.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => onOpenMore('reviewlog')}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{sentence(row)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function Aside({
  me,
  page,
  moreScreen,
  queue,
  refresh,
  onOpenWorkout,
  onOpenMember,
  onOpenCalendarDay,
  onOpenMore,
}: {
  me: Me
  // Which tab is underneath, which decides what the top block of the column
  // is. Nothing else on it changes with the screen.
  page: Page
  // Which screen the More tab is on, because a handful of them are reviewing
  // work and the column belongs to that while they are open.
  moreScreen: Screen
  // How much is in the review queue, counted once above this column.
  queue: number
  refresh: number
  onOpenWorkout: (id: number) => void
  onOpenMember: (userId: number) => void
  // A day picked off the month, opened on the calendar itself.
  onOpenCalendarDay: (date: string) => void
  // A screen under More, opened from the column.
  onOpenMore: (screen: Screen) => void
}) {
  const [strip, setStrip] = useState<TodayStrip | null>(null)
  const todayIso = today(me.timezone)
  const slot = useAsideSlotNode()
  const month = page === 'dashboard'
  const reviewing = page === 'more' && REVIEW_SCREENS.includes(moreScreen) && reviews(me)

  useEffect(() => {
    if (month || reviewing) return
    let alive = true
    api<TodayStrip>('/feed/today')
      .then((row) => alive && setStrip(row))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [refresh, month, reviewing])

  return (
    <>
      {slot !== null ? (
        slot
      ) : reviewing ? (
        <Reviewing
          me={me}
          queue={queue}
          atQueue={moreScreen === 'queue'}
          refresh={refresh}
          onOpenMore={onOpenMore}
        />
      ) : month ? (
        <MiniMonth me={me} refresh={refresh} onOpenDay={onOpenCalendarDay} />
      ) : (
        <div>
          <p className="t-micro mb-2">Today's numbers</p>
          <div className="t-card grid grid-cols-2 gap-3">
            <Figure
              label="Consumed"
              value={
                strip === null || strip.calories_eaten === null
                  ? '-'
                  : `${Math.round(strip.calories_eaten).toLocaleString()} cal`
              }
            />
            <Figure
              label="Steps"
              value={
                strip === null || strip.steps === null
                  ? '-'
                  : Math.round(strip.steps).toLocaleString()
              }
            />
            <Figure
              label="Activity"
              value={
                strip === null || strip.exercise_min === null
                  ? '-'
                  : `${Math.round(strip.exercise_min).toLocaleString()} min`
              }
            />
            <Figure
              label="Weight"
              value={
                strip === null || strip.latest_weight_kg === null
                  ? '-'
                  : weightText(strip.latest_weight_kg, me.units)
              }
              note={
                strip === null || strip.latest_weight_date === null
                  ? undefined
                  : dayLabel(strip.latest_weight_date, todayIso)
              }
            />
            <Figure
              label="Contributions"
              value={strip === null ? '-' : strip.contributions.toLocaleString()}
              note={
                strip !== null && strip.pending > 0 ? `${strip.pending} pending` : undefined
              }
            />
          </div>
        </div>
      )}

      {/* The feed takes what is left of the column and scrolls inside its own
          card, so Show more never pushes the column past the window. It has no
          place on a reviewing screen. */}
      {!reviewing && (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="t-micro mb-2">Community</p>
          <div className="t-card min-h-[12rem] flex-1 overflow-y-auto">
            <Feed
              me={me}
              refresh={refresh}
              onOpenWorkout={onOpenWorkout}
              onOpenMember={onOpenMember}
            />
          </div>
        </div>
      )}
    </>
  )
}
