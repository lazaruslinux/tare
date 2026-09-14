import { Repeat, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  calendarConflicts,
  createAppointment,
  detachOccurrence,
  errorText,
  patchAppointment,
  removeAppointment,
  sharedCalendars,
  api,
  type AppointmentBody,
  type AppointmentRaw,
  type ConflictHit,
  type ConflictReport,
  type FriendsPage,
  type Me,
  type MemberRow,
  type SharedCalendar,
} from '../../api'
import { useClock } from '../../lib/clock'
import { colorToken, formatTimeRange, nowMinutesIn, PERSONAL } from '../../lib/calendar'
import { today, weekday } from '../../lib/day'
import { Avatar } from '../Avatar'
import { ConfirmSheet } from '../ConfirmSheet'
import { Sheet } from '../Sheet'
import { Switch } from '../Switch'
import {
  draftOf,
  RepeatSheet,
  repeatPayload,
  repeatSummary,
  startingDraft,
  type RepeatDraft,
} from './RepeatSheet'
import { TimeCombo } from './TimeCombo'

// The form one appointment is written in. The same one writes a new one, edits
// a series, and saves one day of a series as a copy of its own.

// How long a new appointment lasts before anybody says otherwise.
const HOUR = 1
// What an appointment on a later day opens at, when nothing else says.
const WORKING_HOUR = 9

// The same sentences the server would answer with, said before it is asked.
const NEEDS_TITLE = 'Give it a title.'
const END_BEFORE_START = 'End time must be after the start time.'
const BAD_END_DATE = 'The end date must be on or after the start date.'

const pad = (value: number): string => String(value).padStart(2, '0')

// One clash, in a line: what it is, when it is, and whose day it is on.
function hitText(hit: ConflictHit, clock: '12h' | '24h'): string {
  const who = hit.calendar === null ? hit.who : `${hit.who}, ${hit.calendar}`
  return `Overlaps: ${hit.title}, ${formatTimeRange(hit.start, hit.end, clock)} (${who})`
}

export function AppointmentSheet({
  me,
  appointment,
  startDate,
  startHour,
  occurrence,
  onClose,
  onSaved,
  onRemoved,
}: {
  me: Me
  // What is being edited, or null for a new one.
  appointment: AppointmentRaw | null
  // The day a new one lands on, and the hour it starts at when somebody
  // tapped one.
  startDate: string
  startHour?: number
  // Set when this is one day of a series being saved as a copy of its own.
  // The form is filled from the series and the copy does not repeat.
  occurrence?: string
  onClose: () => void
  onSaved: () => void
  // Removing the whole appointment, which only its owner is offered.
  onRemoved?: () => void
}) {
  const clock = useClock()
  const creating = appointment === null
  const detaching = !creating && occurrence !== undefined
  const owner = creating || appointment.mine
  const firstDate = appointment?.date_for ?? startDate
  // A new appointment opens on the hour somebody tapped, on the next hour when
  // it is today, and at nine on any other day. The hour is the account's own,
  // the same one every other time on screen is read in.
  const openingHour = (): number => {
    if (startHour !== undefined) return Math.min(startHour, 22)
    if (startDate !== today(me.timezone)) return WORKING_HOUR
    return Math.min(Math.floor(nowMinutesIn(me.timezone) / 60) + 1, 22)
  }

  const [title, setTitle] = useState(appointment?.title ?? '')
  const [notes, setNotes] = useState(appointment?.notes ?? '')
  const [location, setLocation] = useState(appointment?.location ?? '')
  const [allDay, setAllDay] = useState(appointment?.all_day ?? false)
  const [date, setDate] = useState(occurrence ?? firstDate)
  // The end date shadows the start until somebody moves it: one day is the
  // ordinary case and should not need two dates typed.
  const [endDate, setEndDate] = useState(appointment?.end_date ?? occurrence ?? firstDate)
  const [endOwn, setEndOwn] = useState((appointment?.end_date ?? null) !== null)
  const [time, setTime] = useState(
    appointment?.time_of_day ?? (appointment === null ? `${pad(openingHour())}:00` : '')
  )
  const [endTime, setEndTime] = useState(
    appointment?.end_time ?? (appointment === null ? `${pad(openingHour() + HOUR)}:00` : '')
  )
  // A copy of a series never repeats, so its pattern is left behind with the
  // series it came from.
  const [repeats, setRepeats] = useState(appointment?.repeat != null && !detaching)
  const [repeat, setRepeat] = useState<RepeatDraft>(() =>
    appointment?.repeat != null && !detaching
      ? draftOf(appointment.repeat, firstDate)
      : startingDraft(firstDate, (weekday(firstDate) + 6) % 7)
  )
  const [patterning, setPatterning] = useState(false)

  const [shelves, setShelves] = useState<SharedCalendar[]>([])
  const [chosen, setChosen] = useState<number[]>(
    appointment?.calendars.map((one) => one.id) ?? []
  )
  const [friends, setFriends] = useState<MemberRow[]>([])
  const [invited, setInvited] = useState<number[]>(
    appointment?.invitees.map((one) => one.id) ?? []
  )
  const [picking, setPicking] = useState(false)
  const [clashes, setClashes] = useState<ConflictReport | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    sharedCalendars()
      .then((rows) => alive && setShelves(rows.filter((row) => !row.mine_pending)))
      .catch(() => undefined)
    if (owner) {
      api<FriendsPage>('/feed/friends')
        .then((page) => alive && setFriends(page.friends))
        .catch(() => undefined)
    }
    return () => {
      alive = false
    }
  }, [owner])

  // A repeating appointment lives on its pattern rather than on a span, which
  // is what the server stores and what it refuses to store together.
  const span = !repeats && endOwn && endDate > date ? endDate : ''
  const timesOk =
    allDay ||
    (time !== '' && endTime !== '' && `${span || date}T${endTime}` > `${date}T${time}`)
  const spanOk = span === '' || span >= date

  const changeDate = (next: string) => {
    setDate(next)
    if (!endOwn) setEndDate(next)
    // The day it starts on is the day a pattern would count from, so the two
    // can never disagree. A pattern already chosen keeps its days; one that
    // has not been opened yet follows the new date's own weekday.
    setRepeat(
      repeats
        ? { ...repeat, anchor: next }
        : startingDraft(next, (weekday(next) + 6) % 7)
    )
  }

  // What the conflict check is about. Held as text so the effect below only
  // asks again when one of the answers really changed.
  const proposal = JSON.stringify({
    date,
    span,
    time,
    endTime,
    allDay,
    repeat: repeats ? repeatPayload(repeat) : null,
    invited,
  })
  const asked = useRef('')

  useEffect(() => {
    if (allDay || time === '' || endTime === '' || !timesOk) {
      setClashes(null)
      return
    }
    if (asked.current === proposal) return
    const timer = window.setTimeout(() => {
      asked.current = proposal
      calendarConflicts({
        date_for: date,
        end_date: span === '' ? null : span,
        time_of_day: time,
        end_time: endTime,
        all_day: allDay,
        timezone: appointment?.timezone ?? me.timezone,
        repeat: repeats ? repeatPayload(repeat) : null,
        exclude_id: appointment?.id ?? null,
        invitee_ids: invited,
      })
        .then(setClashes)
        // A warning that could not be fetched is not a refusal: the form
        // saves either way, and the server checks nothing here.
        .catch(() => setClashes(null))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [proposal, timesOk])

  const toggleCalendar = (id: number) =>
    setChosen(chosen.includes(id) ? chosen.filter((one) => one !== id) : [...chosen, id])

  const savePattern = (next: RepeatDraft) => {
    setRepeat(next)
    setRepeats(true)
    setPatterning(false)
    // The pattern's own start is the appointment's start, and a repeating one
    // never spans days.
    if (next.anchor !== '') {
      setDate(next.anchor)
      setEndDate(next.anchor)
    }
    setEndOwn(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (title.trim() === '') {
      setError(NEEDS_TITLE)
      return
    }
    if (!spanOk) {
      setError(BAD_END_DATE)
      return
    }
    if (!timesOk) {
      setError(END_BEFORE_START)
      return
    }
    setSaving(true)
    setError('')
    const body: AppointmentBody = {
      title: title.trim(),
      notes,
      location: location.trim() === '' ? null : location.trim(),
      all_day: allDay,
      date_for: date,
      end_date: span === '' ? null : span,
      time_of_day: allDay ? null : time,
      end_time: allDay ? null : endTime,
      repeat: repeats && !detaching ? repeatPayload(repeat) : null,
    }
    try {
      if (creating) {
        await createAppointment({ ...body, calendar_ids: chosen, invitee_ids: invited })
      } else if (detaching && occurrence !== undefined) {
        // The copy inherits the series' calendars and invitations, so neither
        // is sent with it.
        await detachOccurrence(appointment.id, occurrence, body)
      } else if (owner) {
        await patchAppointment(appointment.id, {
          ...body,
          calendar_ids: chosen,
          invitee_ids: invited,
        })
      } else {
        // A member editing somebody else's appointment changes what it says,
        // never who can see it.
        await patchAppointment(appointment.id, body)
      }
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  const remove = async () => {
    if (appointment === null) return
    setSaving(true)
    try {
      await removeAppointment(appointment.id)
      setRemoving(false)
      onRemoved?.()
    } catch (failure) {
      setError(errorText(failure))
      setRemoving(false)
      setSaving(false)
    }
  }

  const mineHits = clashes?.mine ?? []
  const guestHits = Object.entries(clashes?.invitees ?? {}).flatMap(([id, hits]) =>
    hits.map((hit) => ({ id, hit }))
  )
  const elsewhere = appointment !== null && appointment.timezone !== me.timezone

  return (
    <>
      <Sheet
        open
        label={creating ? 'New appointment' : 'Edit appointment'}
        tall
        onClose={onClose}
      >
        <form onSubmit={submit}>
          <p className="mb-3 text-base font-semibold">
            {creating ? 'New appointment' : detaching ? 'Edit this day' : 'Edit appointment'}
          </p>

          <div className="mb-3">
            <label className="t-label" htmlFor="appointment-title">
              Title
            </label>
            <input
              id="appointment-title"
              className="t-input"
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className="mb-1">
            <Switch
              label="All day"
              checked={allDay}
              onChange={(next) => {
                setAllDay(next)
                if (next) {
                  setTime('')
                  setEndTime('')
                } else {
                  setTime(`${pad(openingHour())}:00`)
                  setEndTime(`${pad(openingHour() + HOUR)}:00`)
                }
              }}
            />
          </div>

          <div className="mb-3 grid gap-3 min-[420px]:grid-cols-2">
            <div>
              <label className="t-label" htmlFor="appointment-date">
                Starts
              </label>
              <input
                id="appointment-date"
                className="t-input"
                type="date"
                value={date}
                onChange={(event) => changeDate(event.target.value)}
              />
            </div>
            {!allDay && (
              <TimeCombo
                id="appointment-time"
                label="At"
                value={time}
                onChange={(next) => {
                  // Moving the start keeps the length it already had.
                  if (time !== '' && endTime !== '' && next !== '') {
                    const was = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
                    const ended = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3))
                    const moved =
                      Number(next.slice(0, 2)) * 60 + Number(next.slice(3)) + (ended - was)
                    if (moved < 24 * 60) {
                      setEndTime(`${pad(Math.floor(moved / 60))}:${pad(moved % 60)}`)
                    }
                  }
                  setTime(next)
                }}
              />
            )}
          </div>

          <div className="mb-3 grid gap-3 min-[420px]:grid-cols-2">
            {/* A repeating appointment cannot run across days, so while it
                repeats there is only an end time to give. */}
            {!repeats && (
              <div>
                <label className="t-label" htmlFor="appointment-end-date">
                  Ends
                </label>
                <input
                  id="appointment-end-date"
                  className="t-input"
                  type="date"
                  value={endDate}
                  onChange={(event) => {
                    setEndDate(event.target.value)
                    setEndOwn(event.target.value !== '' && event.target.value !== date)
                  }}
                />
              </div>
            )}
            {!allDay && (
              <TimeCombo
                id="appointment-end-time"
                label="To"
                value={endTime}
                anchor={time}
                onChange={setEndTime}
              />
            )}
          </div>

          {!spanOk && <p className="t-error mb-2">{BAD_END_DATE}</p>}
          {!allDay && time !== '' && endTime !== '' && !timesOk && (
            <p className="t-error mb-2">{END_BEFORE_START}</p>
          )}

          {mineHits.length + guestHits.length > 0 && (
            <div className="mb-3">
              {mineHits.map((hit) => (
                <p key={`mine-${hit.appointment_id}-${hit.date}`} className="t-note">
                  {hitText(hit, clock)}
                </p>
              ))}
              {guestHits.map(({ id, hit }) => (
                <p key={`${id}-${hit.appointment_id}-${hit.date}`} className="t-note">
                  {hitText(hit, clock)}
                </p>
              ))}
            </div>
          )}

          {elsewhere && <p className="t-note mb-3">Times in {appointment.timezone}.</p>}

          {!detaching && (
            <button
              type="button"
              className="t-row w-full text-left"
              onClick={() => setPatterning(true)}
            >
              <Repeat className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">Repeat</span>
                <span className="block text-sm">
                  {repeats ? repeatSummary(repeat) : 'Does not repeat'}
                </span>
              </span>
            </button>
          )}

          <div className="mb-3">
            <label className="t-label" htmlFor="appointment-location">
              Location
            </label>
            <input
              id="appointment-location"
              className="t-input"
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </div>

          <div className="mb-3">
            <label className="t-label" htmlFor="appointment-notes">
              Notes
            </label>
            <textarea
              id="appointment-notes"
              className="t-input"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {shelves.length > 0 && (
            <div className="mb-3">
              <p className="t-label">Add to calendar</p>
              {owner ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={chosen.length === 0}
                    className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
                    onClick={() => setChosen([])}
                  >
                    <Dot color={PERSONAL} /> Only mine
                  </button>
                  {shelves.map((shelf) => (
                    <button
                      key={shelf.id}
                      type="button"
                      aria-pressed={chosen.includes(shelf.id)}
                      className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
                      onClick={() => toggleCalendar(shelf.id)}
                    >
                      <Dot color={colorToken(shelf.color)} /> {shelf.name}
                    </button>
                  ))}
                  {shelves.length > 1 && (
                    <button
                      type="button"
                      aria-pressed={chosen.length === shelves.length}
                      className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
                      onClick={() => setChosen(shelves.map((shelf) => shelf.id))}
                    >
                      All
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {appointment !== null && appointment.calendars.length > 0
                    ? appointment.calendars.map((one) => one.name).join(' · ')
                    : 'Only its owner can change where this is shared.'}
                </p>
              )}
            </div>
          )}

          {owner && (
            <div className="mb-3">
              <p className="t-label">Invite friends</p>
              <div className="flex flex-wrap items-center gap-2">
                {invited.map((id) => (
                  <span key={id} className="t-chip">
                    {friends.find((friend) => friend.id === id)?.display_name ??
                      appointment?.invitees.find((one) => one.id === id)?.display_name ??
                      'Friend'}
                    <button
                      type="button"
                      aria-label="Remove"
                      className="t-tap44 text-muted"
                      onClick={() => setInvited(invited.filter((one) => one !== id))}
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  </span>
                ))}
                <button type="button" className="t-chip t-tap44" onClick={() => setPicking(true)}>
                  Invite friends
                </button>
              </div>
            </div>
          )}

          {error !== '' && <p className="t-error mt-3">{error}</p>}

          <button
            className="t-btn t-btn-primary mt-4 w-full"
            type="submit"
            disabled={saving}
          >
            Save
          </button>
          {!creating && owner && onRemoved !== undefined && (
            <button
              type="button"
              className="t-btn mt-2 w-full"
              onClick={() => setRemoving(true)}
            >
              Remove
            </button>
          )}
        </form>
      </Sheet>

      {patterning && (
        <RepeatSheet
          open
          draft={repeat}
          onCancel={() => setPatterning(false)}
          onSave={savePattern}
          onStop={
            repeats
              ? () => {
                  setRepeats(false)
                  setPatterning(false)
                }
              : undefined
          }
        />
      )}

      {picking && (
        <FriendPicker
          friends={friends}
          chosen={invited}
          onToggle={(id) =>
            setInvited(invited.includes(id) ? invited.filter((one) => one !== id) : [...invited, id])
          }
          onClose={() => setPicking(false)}
        />
      )}

      <ConfirmSheet
        open={removing}
        label="Remove appointment"
        question="Remove this appointment?"
        note={
          appointment?.repeat != null
            ? 'Every day of the series goes, and everybody it is shared with loses it.'
            : 'Everybody it is shared with loses it.'
        }
        verb="Remove"
        busy={saving}
        onConfirm={() => void remove()}
        onClose={() => setRemoving(false)}
      />
    </>
  )
}

// A colour standing for a calendar, small enough to sit inside a chip.
function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

// Who to ask, out of the friends this account has. Multi-select: a lunch is
// often two or three people, and the sheet stays open until it is done.
function FriendPicker({
  friends,
  chosen,
  onToggle,
  onClose,
}: {
  friends: MemberRow[]
  chosen: number[]
  onToggle: (id: number) => void
  onClose: () => void
}) {
  return (
    <Sheet open label="Invite friends" tall onClose={onClose}>
      <p className="mb-3 text-base font-semibold">Invite friends</p>
      {friends.length === 0 ? (
        <p className="text-sm text-muted">
          Nobody yet. Add friends under More, then Members.
        </p>
      ) : (
        <div>
          {friends.map((friend) => (
            <button
              key={friend.id}
              type="button"
              aria-pressed={chosen.includes(friend.id)}
              className="t-row w-full text-left"
              onClick={() => onToggle(friend.id)}
            >
              <Avatar url={friend.avatar_url} name={friend.display_name} />
              <span className="min-w-0 flex-1 truncate text-sm">{friend.display_name}</span>
              {chosen.includes(friend.id) && <span className="t-chip text-accent">Invited</span>}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="t-btn t-btn-primary mt-4 w-full" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}
