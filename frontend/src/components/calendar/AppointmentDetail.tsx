import { useState } from 'react'

import {
  api,
  answerInvitation,
  cancelOccurrence,
  errorText,
  removeAppointment,
  removeOccurrence,
  type Occurrence,
} from '../../api'
import { dateText, useClock } from '../../lib/clock'
import { colorToken, formatTimeRange, PERSONAL } from '../../lib/calendar'
import { ConfirmSheet } from '../ConfirmSheet'
import { Sheet } from '../Sheet'
import { repeatSummary, draftOf } from './RepeatSheet'

// One appointment as it is read rather than written: when it is, who else has
// it, and the few things that can be done to it from here.
//
// A repeating one asks the same question a desktop calendar asks before either
// of those: this day, or the whole series.

// What an invitee's answer reads as, to the person who asked them.
const ANSWER: Record<string, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  pending: 'Awaiting reply',
}

// Whether a location is worth offering a map for. One word with no number in
// it is a room or a nickname, not an address.
const mappable = (place: string): boolean =>
  /\d/.test(place) || place.trim().split(/\s+/).length > 1

const mapUrl = (place: string): string =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(place)}`

type Choosing = 'edit' | 'remove' | null

export function AppointmentDetail({
  item,
  onClose,
  onEdit,
  onChanged,
}: {
  item: Occurrence
  onClose: () => void
  // Editing it: the whole series, or the one day, which is saved as a copy of
  // its own. The page loads the appointment itself and opens the form.
  onEdit: (occurrence?: string) => void
  // Something about it changed on the server.
  onChanged: () => void
}) {
  const clock = useClock()
  const [choosing, setChoosing] = useState<Choosing>(null)
  // A removal is asked twice, the way the rest of the app asks: the second tap
  // on the same button is the answer.
  const [armed, setArmed] = useState<'one' | 'all' | null>(null)
  // Backing out of an invitation is asked the way every other removal is.
  const [declining, setDeclining] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const repeats = item.repeat !== null
  const owner = item.mine
  // The reader's own invitation, when that is how they are on it at all.
  const invitation = item.role === 'invitee' ? item.invitation : null
  const spans = item.end_date !== item.date
  const when = spans
    ? `${dateText(item.date)} to ${dateText(item.end_date)}`
    : dateText(item.date)
  const hours =
    item.all_day || item.start === null ? 'All day' : formatTimeRange(item.start, item.end, clock)

  const run = async (act: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await act()
      onChanged()
      onClose()
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  const removeOne = () => {
    if (armed !== 'one') {
      setArmed('one')
      return
    }
    void run(() => removeOccurrence(item.id, item.occurrence_date))
  }

  const removeAll = () => {
    if (armed !== 'all') {
      setArmed('all')
      return
    }
    void run(() => removeAppointment(item.id))
  }

  const edit = () => {
    if (repeats && !item.detached) {
      setChoosing('edit')
      return
    }
    onEdit()
  }

  const startRemove = () => {
    if (repeats && !item.detached) {
      setChoosing('remove')
      return
    }
    removeAll()
  }

  return (
    <>
      <Sheet open label={item.title} tall onClose={onClose}>
        <div className="mb-2 flex items-start gap-2">
          <p
            className={`min-w-0 flex-1 text-base font-semibold ${
              item.cancelled ? 'text-muted line-through' : ''
            }`}
          >
            {item.title}
          </p>
          {item.cancelled && <span className="t-chip shrink-0">Cancelled</span>}
          {invitation?.status === 'accepted' && <span className="t-chip shrink-0">Accepted</span>}
        </div>

        <p className="t-nums text-sm">
          {when} · {hours}
        </p>
        {repeats && item.repeat !== null && (
          <p className="t-note">{repeatSummary(draftOf(item.repeat, item.date))}</p>
        )}

        {item.location !== null && item.location !== '' && (
          <p className="mt-2 text-sm">
            {mappable(item.location) ? (
              <a className="t-link" href={mapUrl(item.location)} target="_blank" rel="noreferrer">
                {item.location}
              </a>
            ) : (
              item.location
            )}
          </p>
        )}

        {item.notes !== '' && <p className="mt-2 text-sm whitespace-pre-line">{item.notes}</p>}

        {(item.mine || item.calendars.length > 0) && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            On:
            {/* Somebody else's appointment is not on this account's own
                calendar. It is readable here because a calendar it is on is
                shared, and that is the only place it sits. */}
            {item.mine && (
              <span className="flex items-center gap-1.5">
                <Dot color={PERSONAL} /> Personal
              </span>
            )}
            {item.calendars.map((shelf) => (
              <span key={shelf.id} className="flex items-center gap-1.5">
                <Dot color={colorToken(shelf.color)} /> {shelf.name}
              </span>
            ))}
          </p>
        )}

        {owner && item.invitees.length > 0 && (
          <div className="mt-3">
            <p className="t-label">Invited</p>
            {item.invitees.map((guest) => (
              <div key={guest.id} className="t-row">
                <span className="min-w-0 flex-1 truncate text-sm">{guest.display_name}</span>
                <span className="t-chip">{ANSWER[guest.status ?? 'pending']}</span>
              </div>
            ))}
          </div>
        )}
        {!owner && <p className="mt-3 text-sm text-muted">From {item.owner.display_name}</p>}

        {error !== '' && <p className="t-error mt-3">{error}</p>}

        {/* The chooser stands in for the whole list of actions, so there is
            nothing else to tap while the question is open. */}
        {choosing !== null ? (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm text-muted">
              {choosing === 'edit'
                ? 'This appointment repeats. Edit one day, or every day?'
                : 'This appointment repeats. Remove one day, or every day?'}
            </p>
            <button
              type="button"
              className={`t-btn ${choosing === 'remove' ? 't-btn-danger' : 't-btn-primary'}`}
              disabled={busy}
              onClick={
                choosing === 'edit' ? () => onEdit(item.occurrence_date) : removeOne
              }
            >
              {choosing === 'remove' && armed === 'one'
                ? 'Tap again to remove this day'
                : 'Just this appointment'}
            </button>
            <button
              type="button"
              className={`t-btn ${choosing === 'remove' ? 't-btn-danger' : ''}`}
              disabled={busy}
              onClick={choosing === 'edit' ? () => onEdit() : removeAll}
            >
              {choosing === 'remove' && armed === 'all'
                ? 'Tap again to remove them all'
                : 'The whole series'}
            </button>
            <button
              type="button"
              className="t-btn"
              onClick={() => {
                setChoosing(null)
                setArmed(null)
              }}
            >
              Back
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            {item.editable && (
              <button type="button" className="t-btn t-btn-primary" disabled={busy} onClick={edit}>
                Edit
              </button>
            )}
            {owner && (
              <button
                type="button"
                className="t-btn"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    cancelOccurrence(item.id, item.occurrence_date, !item.cancelled)
                  )
                }
              >
                {item.cancelled ? 'Un-cancel this appointment' : 'Cancel this appointment'}
              </button>
            )}
            {owner && (
              <button type="button" className="t-btn t-btn-danger" disabled={busy} onClick={startRemove}>
                {armed === 'all' ? 'Tap again to remove' : 'Remove'}
              </button>
            )}
            {/* Somebody who shares a calendar it is on takes it off that
                calendar rather than deleting what is not theirs. */}
            {!owner &&
              item.role === 'member' &&
              item.calendars.map((shelf) => (
                <button
                  key={shelf.id}
                  type="button"
                  className="t-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      api(`/calendar/appointments/${item.id}/calendars/${shelf.id}`, {
                        method: 'DELETE',
                      })
                    )
                  }
                >
                  Remove from {shelf.name}
                </button>
              ))}
            {invitation !== null && (
              <button
                type="button"
                className="t-btn"
                disabled={busy}
                onClick={() => setDeclining(true)}
              >
                Decline
              </button>
            )}
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={declining}
        label="Decline invitation"
        question={`Decline ${item.title}?`}
        note={`It leaves your calendar, and ${item.owner.display_name} would have to ask you again.`}
        verb="Decline"
        busy={busy}
        error={error}
        onConfirm={() =>
          invitation !== null && void run(() => answerInvitation(invitation.id, false))
        }
        onClose={() => setDeclining(false)}
      />
    </>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}
