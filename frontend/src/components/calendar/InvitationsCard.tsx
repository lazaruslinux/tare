import { useEffect, useState } from 'react'

import {
  answerCalendar,
  answerInvitation,
  calendarInvitations,
  errorText,
  type ConflictHit,
  type Invitation,
} from '../../api'
import { dateText, useClock } from '../../lib/clock'
import { colorToken, formatTimeRange } from '../../lib/calendar'
import { ConfirmSheet } from '../ConfirmSheet'
import { tintOf } from './DayTimeline'

// What is waiting on an answer, at the top of the calendar: appointments
// somebody asked this account to, and calendars somebody shared with it. The
// card is not there at all when there is nothing in it.

// Which answer is being asked about before it is given.
type Declining = { kind: 'meeting' | 'calendar'; id: number; name: string }

const EMPTY: Invitation = { meetings: [], calendars: [] }

// One clash, in the words of the person reading it. Their own day is the only
// one the server reports here, so every one of these is theirs.
function hitText(hit: ConflictHit, clock: '12h' | '24h'): string {
  return `Overlaps your ${hit.title}, ${formatTimeRange(hit.start, hit.end, clock)}`
}

export function InvitationsCard({
  refresh,
  onAnswered,
}: {
  // The app-wide change tick: the list is read again on every bump.
  refresh: number
  // An invitation was answered, so the grid behind this holds something new.
  onAnswered: () => void
}) {
  const clock = useClock()
  const [waiting, setWaiting] = useState<Invitation>(EMPTY)
  const [declining, setDeclining] = useState<Declining | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)

  useEffect(() => {
    let alive = true
    calendarInvitations()
      .then((loaded) => {
        if (!alive) return
        setWaiting(loaded)
        setError('')
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [refresh, again])

  const answer = async (act: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await act()
      setDeclining(null)
      setAgain((count) => count + 1)
      onAnswered()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const count = waiting.meetings.length + waiting.calendars.length
  if (count === 0 && error === '') return null

  return (
    <>
      <div className="t-card mb-3">
        <p className="t-card-title mb-1">Invitations</p>

        {error !== '' && <p className="t-error mb-2">{error}</p>}

        {waiting.meetings.map((one) => {
          const item = one.appointment
          const spans = item.end_date !== item.date
          const when = spans
            ? `${dateText(item.date)} to ${dateText(item.end_date)}`
            : dateText(item.date)
          const hours =
            item.all_day || item.start === null
              ? 'All day'
              : formatTimeRange(item.start, item.end, clock)
          return (
            <div key={one.invite_id} className="t-row flex-wrap gap-y-2">
              <Dot color={tintOf(item)} />
              <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] min-[420px]:basis-auto">
                <span className="block text-sm">
                  {one.from.display_name} invited you to {item.title}
                </span>
                <span className="t-nums block text-xs text-muted">
                  {when} · {hours}
                </span>
                {one.conflicts.map((hit) => (
                  <span key={`${hit.appointment_id}-${hit.date}`} className="t-note block">
                    {hitText(hit, clock)}
                  </span>
                ))}
              </span>
              <Answers
                busy={busy}
                onAccept={() => void answer(() => answerInvitation(one.invite_id, true))}
                onDecline={() =>
                  setDeclining({ kind: 'meeting', id: one.invite_id, name: item.title })
                }
              />
            </div>
          )
        })}

        {waiting.calendars.map((one) => (
          <div key={one.calendar_id} className="t-row flex-wrap gap-y-2">
            <Dot color={colorToken(one.color)} />
            <span className="min-w-0 flex-1 basis-[calc(100%-2rem)] min-[420px]:basis-auto">
              <span className="block text-sm">
                {one.from.display_name} shared a calendar with you: {one.name}
              </span>
              <span className="block truncate text-xs text-muted">{one.members.join(' · ')}</span>
            </span>
            <Answers
              busy={busy}
              onAccept={() => void answer(() => answerCalendar(one.calendar_id, true))}
              onDecline={() =>
                setDeclining({ kind: 'calendar', id: one.calendar_id, name: one.name })
              }
            />
          </div>
        ))}
      </div>

      <ConfirmSheet
        open={declining !== null}
        label="Decline invitation"
        question={declining === null ? '' : `Decline ${declining.name}?`}
        note="The invitation goes, and they would have to ask you again."
        verb="Decline"
        busy={busy}
        onConfirm={() =>
          declining !== null &&
          void answer(() =>
            declining.kind === 'meeting'
              ? answerInvitation(declining.id, false)
              : answerCalendar(declining.id, false)
          )
        }
        onClose={() => setDeclining(null)}
      />
    </>
  )
}

// The colour the row is about: the calendar an appointment would land on, or
// the shared calendar itself. Both rows lead with one, so their words line up.
function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}

// The two answers, as one pair, so a meeting row and a calendar row end the
// same way. Under the words on a phone, where a sentence beside two buttons
// wraps to three lines and neither half has room.
function Answers({
  busy,
  onAccept,
  onDecline,
}: {
  busy: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <span className="ml-auto flex shrink-0 gap-2">
      <button type="button" className="t-chip t-tap44 text-accent" disabled={busy} onClick={onAccept}>
        Accept
      </button>
      <button type="button" className="t-chip t-tap44" disabled={busy} onClick={onDecline}>
        Decline
      </button>
    </span>
  )
}
