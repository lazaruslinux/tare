import { useReducedMotion } from 'framer-motion'
import { ChevronRight, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  calendarDays,
  errorText,
  readAppointment,
  type AppointmentRaw,
  type Me,
  type Occurrence,
} from '../../api'
import { dateText } from '../../lib/clock'
import { minutesOf } from '../../lib/calendar'
import { today } from '../../lib/day'
import { useRailLayout } from '../../hooks/useWideLayout'
import { AppointmentDetail } from './AppointmentDetail'
import { AppointmentSheet } from './AppointmentSheet'
import { allDayItems, DayTimeline, pack, tintOf, useNowMinutes } from './DayTimeline'

// What is on today, at the top of the Dashboard: the hours around now and what
// is in them, rather than a list that says nothing about when.

const MINUTE = 60
const HOURS = 24
// How far either side of now the window reaches before anything on the day
// stretches it, and the least it is ever drawn at.
const BEFORE = 60
const AFTER = 180
const LEAST_HOURS = 3
// An hour's height, and how tall the card lets the window grow before it
// scrolls inside itself.
const HOUR_PX = 44
const WIDE_HOUR_PX = 56
const CAP = 220
const WIDE_CAP = 320

// The hours the card draws: around now, widened to take in whatever the day
// already holds.
export function windowHours(
  items: Occurrence[],
  nowMinutes: number
): { fromHour: number; toHour: number } {
  const timed = items.filter((item) => !item.all_day && item.start !== null)
  const starts = timed.map((item) =>
    item.continues_from_previous ? 0 : minutesOf(item.start ?? '00:00')
  )
  const ends = timed.map((item) =>
    item.continues_to_next ? HOURS * MINUTE : minutesOf(item.end ?? '00:00')
  )
  const from = Math.min(nowMinutes - BEFORE, ...starts)
  const to = Math.max(nowMinutes + AFTER, ...ends)
  const fromHour = Math.max(0, Math.floor(from / MINUTE))
  const toHour = Math.min(HOURS, Math.max(Math.ceil(to / MINUTE), fromHour + LEAST_HOURS))
  return { fromHour: Math.min(fromHour, HOURS - LEAST_HOURS), toHour }
}

export function TodayCard({
  me,
  refresh,
  onOpenCalendar,
  onChanged,
}: {
  me: Me
  // The app-wide change tick: today is read again on every bump.
  refresh: number
  // The Calendar screen, opened on the day this card is about.
  onOpenCalendar: (date: string) => void
  onChanged: () => void
}) {
  const wide = useRailLayout()
  const reduced = useReducedMotion()
  const todayIso = today(me.timezone)
  const nowMinutes = useNowMinutes(me.timezone)
  const scroller = useRef<HTMLDivElement>(null)
  // Where the timeline has been scrolled to, which is what decides whether
  // anything on the day is sitting above its top edge.
  const [scrollTop, setScrollTop] = useState(0)
  const [items, setItems] = useState<Occurrence[]>([])
  const [detail, setDetail] = useState<Occurrence | null>(null)
  const [editing, setEditing] = useState<{ row: AppointmentRaw; occurrence?: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)

  useEffect(() => {
    let alive = true
    calendarDays(todayIso, todayIso)
      .then((loaded) => {
        if (!alive) return
        setItems(loaded.days[0]?.items ?? [])
        setError('')
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [todayIso, refresh, again])

  const reload = () => {
    setAgain(again + 1)
    onChanged()
  }

  const openEdit = async (item: Occurrence, occurrence?: string) => {
    try {
      const row = await readAppointment(item.id)
      setDetail(null)
      setEditing({ row, occurrence })
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  const lane = allDayItems(items)
  const { fromHour, toHour } = windowHours(items, nowMinutes)
  const hourPx = wide ? WIDE_HOUR_PX : HOUR_PX
  // The card opens an hour above now, so whatever the day already held before
  // then is out of sight. Only blocks that ended above the edge count: one
  // half on screen is one somebody can see.
  const above = pack(
    items.filter((item) => !item.all_day && item.start !== null),
    hourPx / MINUTE
  ).filter((one) => !one.item.cancelled && one.top - fromHour * hourPx + one.height < scrollTop)

  return (
    <>
      <div data-tour="dash-calendar" className="t-card mb-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            className="t-card-title t-tap44 flex items-center gap-1"
            aria-label="Today. Opens the calendar."
            onClick={() => onOpenCalendar(todayIso)}
          >
            Today · {dateText(todayIso)}
            <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className="t-topbar-icon -mr-2"
            aria-label="New appointment"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        {error !== '' && <p className="t-error mb-2">{error}</p>}

        {items.length === 0 ? (
          <p className="text-sm text-muted">Nothing on your calendar today.</p>
        ) : (
          <>
            {lane.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {lane.map((item) => (
                  <button
                    key={`${item.id}-${item.occurrence_date}`}
                    type="button"
                    className="t-chip t-tap44"
                    style={{ borderColor: tintOf(item) }}
                    onClick={() => setDetail(item)}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: tintOf(item) }}
                    />
                    <span className={item.cancelled ? 'text-muted line-through' : ''}>
                      {item.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {above.length > 0 && (
              <button
                type="button"
                className="t-row w-full text-left text-sm text-muted"
                onClick={() => {
                  const box = scroller.current
                  if (box === null) return
                  const first = Math.min(...above.map((one) => one.top)) - fromHour * hourPx
                  box.scrollTo({
                    top: Math.max(first - hourPx, 0),
                    behavior: reduced === true ? 'auto' : 'smooth',
                  })
                }}
              >
                {above.length} earlier today
              </button>
            )}
            <DayTimeline
              items={items}
              isToday
              nowMinutes={nowMinutes}
              hourPx={hourPx}
              fromHour={fromHour}
              toHour={toHour}
              height={wide ? WIDE_CAP : CAP}
              wide={wide}
              onOpen={setDetail}
              scrollerRef={scroller}
              onScroll={setScrollTop}
            />
          </>
        )}
      </div>

      {detail !== null && (
        <AppointmentDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(occurrence) => void openEdit(detail, occurrence)}
          onChanged={reload}
        />
      )}

      {editing !== null && (
        <AppointmentSheet
          me={me}
          appointment={editing.row}
          startDate={todayIso}
          occurrence={editing.occurrence}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
          onRemoved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}

      {adding && (
        <AppointmentSheet
          me={me}
          appointment={null}
          startDate={todayIso}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            reload()
          }}
        />
      )}
    </>
  )
}
