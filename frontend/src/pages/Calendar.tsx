import { ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  calendarDays,
  errorText,
  readAppointment,
  type AppointmentRaw,
  type Me,
  type Occurrence,
} from '../api'
import { AgendaList } from '../components/calendar/AgendaList'
import { AppointmentDetail } from '../components/calendar/AppointmentDetail'
import { AppointmentSheet } from '../components/calendar/AppointmentSheet'
import { Avatar } from '../components/Avatar'
import {
  allDayItems,
  DayTimeline,
  markStyle,
  theirs,
  tintOf,
  useNowMinutes,
} from '../components/calendar/DayTimeline'
import { InvitationsCard } from '../components/calendar/InvitationsCard'
import { MiniMonth } from '../components/calendar/MiniMonth'
import { useTopBar } from '../hooks/useTopBar'
import { useRailLayout, useWideLayout } from '../hooks/useWideLayout'
import { useAsideSlot } from '../lib/asideSlot'
import { dateText, useClock } from '../lib/clock'
import {
  formatTime,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
} from '../lib/calendar'
import { shiftDay, today } from '../lib/day'

// The month, and one day of it against the clock. The month is where the
// calendar opens: it is the view somebody scans, and every way deeper into a
// day starts from a cell in it.

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
// How many entries a cell names before it says how many more there are.
const CELL_MARKS = 3
// The page's own timeline: an hour is 64px, which fits a title and its times.
const HOUR_PX = 64

// What the form was opened for: a new appointment on a day, or an existing one
// as a series or as one of its days.
type Form =
  | { kind: 'new'; date: string; hour?: number }
  | { kind: 'edit'; row: AppointmentRaw; occurrence?: string }

export function Calendar({
  me,
  refresh,
  focusDay,
  onBack,
  onChanged,
  onOpenCalendars,
}: {
  me: Me
  // The app-wide change tick. What is on screen is read again on every bump.
  refresh: number
  // A day to open on, from somewhere else in the app. Empty is this month.
  focusDay?: string
  onBack: () => void
  // Something here changed a list the rest of the app shows.
  onChanged: () => void
  // The shared calendars sheet, where there is one to open.
  onOpenCalendars?: () => void
}) {
  const clock = useClock()
  const wide = useRailLayout()
  // Whether there is a column beside the page. What it holds is this screen's
  // to fill, so the day's list and the mini month move into it rather than
  // being said twice.
  const beside = useWideLayout()
  const todayIso = today(me.timezone)
  const nowMinutes = useNowMinutes(me.timezone)
  const [anchor, setAnchor] = useState(() => monthOf(focusDay || todayIso))
  const [selected, setSelected] = useState(focusDay || todayIso)
  // The day being read against the clock, or null for the month.
  const [day, setDay] = useState<string | null>(null)
  // Where the mini month beside an open day has been stepped to, kept with
  // the day it was stepped from: opening another day brings it back to that
  // day's own month. The page's range never moves with it.
  const [mini, setMini] = useState<{ day: string; year: number; month: number } | null>(null)
  const [days, setDays] = useState<Map<string, Occurrence[]>>(new Map())
  const [detail, setDetail] = useState<Occurrence | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)

  const weeks = monthGrid(anchor.year, anchor.month)
  const first = weeks[0][0].date
  const last = weeks[5][6].date

  // The day names itself in its own header, between the arrows that step it,
  // so the bar says where back goes rather than saying the date twice. The
  // plus is the bar's, the way it is on the Journal: the month's own row is
  // full at phone width, and the title is what has to fit in it.
  useTopBar({
    title: 'Calendar',
    back:
      day === null
        ? { label: 'More', onBack }
        : { label: 'Month', onBack: () => setDay(null) },
    action: {
      label: 'New appointment',
      onAct: () => setForm({ kind: 'new', date: day ?? selected }),
    },
  })

  // A day asked for from outside opens once, and then this screen owns where
  // it is again.
  useEffect(() => {
    if (focusDay === undefined || focusDay === '') return
    setAnchor(monthOf(focusDay))
    setSelected(focusDay)
  }, [focusDay])

  // One request for every day the grid shows, empty days included.
  useEffect(() => {
    let alive = true
    calendarDays(first, last)
      .then((loaded) => {
        if (!alive) return
        setDays(new Map(loaded.days.map((one) => [one.date, one.items])))
        setError('')
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [first, last, refresh, again])

  const itemsOn = (iso: string): Occurrence[] => days.get(iso) ?? []

  const reload = () => {
    setAgain(again + 1)
    onChanged()
  }

  const page = (step: number) => {
    const next = shiftMonth(anchor.year, anchor.month, step)
    setAnchor(next)
    const isoFirst = `${next.year}-${String(next.month).padStart(2, '0')}-01`
    setSelected(monthOf(todayIso).month === next.month && monthOf(todayIso).year === next.year ? todayIso : isoFirst)
  }

  const goToday = () => {
    setAnchor(monthOf(todayIso))
    setSelected(todayIso)
    if (day !== null) setDay(todayIso)
  }

  // Opening a day outside the loaded range takes the month with it, so the
  // day is read rather than drawn empty.
  const openDay = (next: string) => {
    if (next < first || next > last) setAnchor(monthOf(next))
    setSelected(next)
    setDay(next)
  }

  const stepDay = (step: number) => openDay(shiftDay(day ?? selected, step))

  const openEdit = async (item: Occurrence, occurrence?: string) => {
    try {
      const row = await readAppointment(item.id)
      setDetail(null)
      setForm({ kind: 'edit', row, occurrence })
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  const agenda = itemsOn(selected)

  // The column beside the page, where there is one: the day the month is
  // asking about, or the month the day on screen belongs to.
  const shown = mini !== null && mini.day === day ? mini : monthOf(day ?? selected)
  useAsideSlot(
    !beside ? null : day === null ? (
      <AgendaList dateIso={selected} items={agenda} clock={clock} onOpen={setDetail} />
    ) : (
      <MiniMonth
        me={me}
        refresh={refresh}
        month={`${shown.year}-${String(shown.month).padStart(2, '0')}`}
        selected={day}
        onOpenDay={openDay}
        onStep={(delta) => setMini({ day, ...shiftMonth(shown.year, shown.month, delta) })}
      />
    )
  )

  return (
    <>
      {error !== '' && <p className="t-error mb-3">{error}</p>}

      {day === null ? (
        <>
          <div className="mb-2 flex items-center gap-1">
            <p className="t-card-title min-w-0 flex-1 truncate">
              {monthTitle(anchor.year, anchor.month)}
            </p>
            <button
              type="button"
              className="t-topbar-icon"
              aria-label="Previous month"
              onClick={() => page(-1)}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="t-topbar-icon"
              aria-label="Next month"
              onClick={() => page(1)}
            >
              <ChevronRight className="h-5 w-5" strokeWidth={2} />
            </button>
            <button type="button" className="t-chip t-tap44" onClick={goToday}>
              Today
            </button>
            {onOpenCalendars !== undefined && (
              <button
                type="button"
                className="t-topbar-icon"
                aria-label="Calendars"
                onClick={onOpenCalendars}
              >
                <Users className="h-5 w-5" strokeWidth={2} />
              </button>
            )}
          </div>

          <InvitationsCard refresh={refresh} onAnswered={reload} />

          <div className="t-cal-grid">
            {DOW.map((letter, index) => (
              <span key={index} className="t-cal-dow">
                {letter}
              </span>
            ))}
            {weeks.flat().map((cell) => (
              <Cell
                key={cell.date}
                date={cell.date}
                number={cell.day}
                items={itemsOn(cell.date)}
                spillover={cell.spillover}
                isToday={cell.date === todayIso}
                selected={cell.date === selected}
                wide={wide}
                clock={clock}
                onSelect={() => setSelected(cell.date)}
                onOpenDay={() => {
                  setSelected(cell.date)
                  setDay(cell.date)
                }}
                onOpenItem={setDetail}
              />
            ))}
          </div>

          {!beside && (
            <div className="mt-3">
              <AgendaList dateIso={selected} items={agenda} clock={clock} onOpen={setDetail} />
            </div>
          )}
        </>
      ) : (
        <div className="t-cal-day">
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              className="t-topbar-icon"
              aria-label="Previous day"
              onClick={() => stepDay(-1)}
            >
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            </button>
            <p className="t-card-title min-w-0 flex-1 truncate text-center">{dateText(day)}</p>
            <button
              type="button"
              className="t-topbar-icon"
              aria-label="Next day"
              onClick={() => stepDay(1)}
            >
              <ChevronRight className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>

          <AllDayLane items={itemsOn(day)} onOpen={setDetail} />
          <DayTimeline
            items={itemsOn(day)}
            isToday={day === todayIso}
            nowMinutes={nowMinutes}
            hourPx={HOUR_PX}
            height={Math.round(window.innerHeight * 0.62)}
            wide={wide}
            onOpen={setDetail}
            onAddAt={(hour) => setForm({ kind: 'new', date: day, hour })}
          />
          <button type="button" className="t-textlink" onClick={() => setDay(null)}>
            Back to the month
          </button>
        </div>
      )}

      {detail !== null && (
        <AppointmentDetail
          item={detail}
          onClose={() => setDetail(null)}
          onEdit={(occurrence) => void openEdit(detail, occurrence)}
          onChanged={reload}
        />
      )}

      {form !== null && (
        <AppointmentSheet
          me={me}
          appointment={form.kind === 'edit' ? form.row : null}
          startDate={form.kind === 'new' ? form.date : selected}
          startHour={form.kind === 'new' ? form.hour : undefined}
          occurrence={form.kind === 'edit' ? form.occurrence : undefined}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            reload()
          }}
          onRemoved={() => {
            setForm(null)
            reload()
          }}
        />
      )}
    </>
  )
}

// The entries with no time of day, above the hours, on the day view.
function AllDayLane({
  items,
  onOpen,
}: {
  items: Occurrence[]
  onOpen: (item: Occurrence) => void
}) {
  const lane = allDayItems(items)
  if (lane.length === 0) return null
  return (
    <div className="t-cal-allday mb-2 rounded-xl border border-line bg-surface">
      {lane.map((item) => (
        <button
          key={`${item.id}-${item.occurrence_date}`}
          type="button"
          className="t-chip t-tap44"
          style={{ borderColor: tintOf(item) }}
          onClick={() => onOpen(item)}
        >
          <span
            aria-hidden="true"
            className={`t-cal-dot h-2 w-2${theirs(item) ? ' t-cal-dot-theirs' : ''}`}
            style={markStyle(item)}
          />
          {theirs(item) && (
            <Avatar size="mark" url={item.owner.avatar_url} name={item.owner.display_name} />
          )}
          <span className={item.cancelled ? 'text-muted line-through' : ''}>{item.title}</span>
        </button>
      ))}
    </div>
  )
}

// One day of the month. The whole cell picks the day, the number opens it
// against the clock, and each mark opens what it stands for.
function Cell({
  date,
  number,
  items,
  spillover,
  isToday,
  selected,
  wide,
  clock,
  onSelect,
  onOpenDay,
  onOpenItem,
}: {
  date: string
  number: number
  items: Occurrence[]
  spillover: boolean
  isToday: boolean
  selected: boolean
  wide: boolean
  clock: '12h' | '24h'
  onSelect: () => void
  onOpenDay: () => void
  onOpenItem: (item: Occurrence) => void
}) {
  const shown = items.slice(0, CELL_MARKS)
  const extra = items.length - shown.length
  return (
    <div
      className={`t-cal-cell${isToday ? ' t-cal-cell-today' : ''}${
        spillover ? ' t-cal-cell-dim' : ''
      }${selected ? ' t-cal-cell-selected' : ''}`}
    >
      {/* Under everything else in the cell, so a mark is tapped on its own and
          anywhere else in the cell picks the day. */}
      <button
        type="button"
        className="absolute inset-0"
        aria-label={`Select ${dateText(date)}`}
        onClick={onSelect}
      />
      <button
        type="button"
        className="t-cal-date t-nums"
        aria-label={`Open ${dateText(date)}`}
        onClick={onOpenDay}
      >
        {number}
      </button>
      {shown.map((item) => {
        const spans = item.all_day || item.date !== item.end_date
        if (!wide) {
          return (
            <button
              key={`${item.id}-${item.occurrence_date}`}
              type="button"
              className={`t-cal-bar${theirs(item) ? ' t-cal-bar-theirs' : ''}`}
              style={{ ...markStyle(item), opacity: item.cancelled ? 0.5 : 1 }}
              onClick={() => onOpenItem(item)}
            >
              {item.title}
            </button>
          )
        }
        if (spans) {
          // A run reads as one band: only the day it starts on carries the
          // name, and the ends are the only corners that are rounded.
          const starts = !item.continues_from_previous
          const ends = !item.continues_to_next
          return (
            <button
              key={`${item.id}-${item.occurrence_date}`}
              type="button"
              className={`t-cal-bar -mx-1 w-auto ${theirs(item) ? 't-cal-bar-theirs ' : ''}${
                starts ? 'ml-0 rounded-l-[5px] ' : ''
              }${ends ? 'mr-0 rounded-r-[5px]' : ''}`}
              style={{ ...markStyle(item), opacity: item.cancelled ? 0.5 : 1 }}
              onClick={() => onOpenItem(item)}
            >
              {/* A band is one line of text rather than a row of boxes, so the
                  mark is set into the line instead of laid beside it. */}
              {starts && theirs(item) && (
                <span className="mr-1 inline-flex align-middle">
                  <Avatar size="mark" url={item.owner.avatar_url} name={item.owner.display_name} />
                </span>
              )}
              <span className={starts ? '' : 'invisible'}>{item.title}</span>
            </button>
          )
        }
        return (
          <button
            key={`${item.id}-${item.occurrence_date}`}
            type="button"
            className="t-cal-chip"
            onClick={() => onOpenItem(item)}
          >
            <span
              aria-hidden="true"
              className={`t-cal-dot h-1.5 w-1.5${theirs(item) ? ' t-cal-dot-theirs' : ''}`}
              style={markStyle(item)}
            />
            <span className="t-cal-chip-time t-nums shrink-0 text-muted">
              {item.start === null ? '' : formatTime(item.start, clock)}
            </span>
            <span className={`truncate ${item.cancelled ? 'text-muted line-through' : ''}`}>
              {item.title}
            </span>
            {theirs(item) && (
              <span className="ml-auto flex shrink-0">
                <Avatar size="mark" url={item.owner.avatar_url} name={item.owner.display_name} />
              </span>
            )}
          </button>
        )
      })}
      {extra > 0 && (
        <button type="button" className="t-cal-more" onClick={onOpenDay}>
          +{extra}
          {wide ? ' more' : ''}
        </button>
      )}
    </div>
  )
}
