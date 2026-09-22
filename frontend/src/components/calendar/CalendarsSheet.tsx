import { Check, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  addCalendarMember,
  answerCalendar,
  api,
  createCalendar,
  errorText,
  patchCalendar,
  removeCalendarMember,
  sharedCalendars,
  type FriendsPage,
  type Me,
  type MemberRow,
  type SharedCalendar,
} from '../../api'
import { colorToken, PALETTE, PERSONAL, type PaletteKey } from '../../lib/calendar'
import { Avatar } from '../Avatar'
import { ConfirmSheet } from '../ConfirmSheet'
import { useInstantSave } from '../SaveMarks'
import { Sheet } from '../Sheet'

// Where shared calendars are made and looked after. One sheet holds the list,
// and the two it opens are the only places a calendar is changed: making one,
// and the settings of one that already exists.

// The line under the list, which is the whole of what sharing means here.
const PRIVACY =
  'Your calendar is private. Only appointments you add to a shared calendar, or invite a friend ' +
  'to, are seen by anyone else. Your own entries are drawn solid. ' +
  "A friend's are outlined, with their picture or initial beside the name."

// The same sentences the server would answer with, said before it is asked.
const NEEDS_NAME = 'Give it a name.'
const NEEDS_FRIEND = 'Pick a friend to share with.'

// An account with nobody to share with, said the way the rest of the app says
// it.
const NO_FRIENDS = 'Nobody yet. Add friends under More, then Members.'

// Who is on a calendar, as its caption. Somebody who has not answered yet is
// named as being waited on rather than listed as though they were already here.
function membersText(row: SharedCalendar): string {
  return row.members
    .map((one) => (one.accepted ? one.display_name : `Waiting for ${one.display_name}`))
    .join(' · ')
}

function creatorName(row: SharedCalendar): string {
  return row.members.find((one) => one.id === row.created_by)?.display_name ?? 'A friend'
}

export function CalendarsSheet({
  me,
  onClose,
  onChanged,
}: {
  me: Me
  onClose: () => void
  // A calendar was made, changed, answered or left, so every list of them
  // elsewhere is out of date.
  onChanged: () => void
}) {
  const [rows, setRows] = useState<SharedCalendar[]>([])
  const [friends, setFriends] = useState<MemberRow[]>([])
  // Which calendar's settings are open, held as an id so the sheet reads the
  // row again after a member is added rather than keeping the old copy.
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [declining, setDeclining] = useState<SharedCalendar | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [again, setAgain] = useState(0)

  useEffect(() => {
    let alive = true
    sharedCalendars()
      .then((loaded) => {
        if (!alive) return
        setRows(loaded)
        setError('')
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [again])

  useEffect(() => {
    let alive = true
    api<FriendsPage>('/feed/friends')
      .then((page) => alive && setFriends(page.friends))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const reload = () => {
    setAgain((count) => count + 1)
    onChanged()
  }

  const answer = async (row: SharedCalendar, yes: boolean) => {
    setBusy(true)
    setError('')
    try {
      await answerCalendar(row.id, yes)
      setDeclining(null)
      reload()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const open = rows.find((row) => row.id === openId) ?? null

  return (
    <>
      <Sheet open label="Calendars" tall onClose={onClose}>
        <p className="mb-3 text-base font-semibold">Calendars</p>

        {error !== '' && <p className="t-error mb-2">{error}</p>}

        <div>
          <div className="t-row">
            <Dot color={PERSONAL} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">Personal</span>
              <span className="block text-xs text-muted">Only you</span>
            </span>
          </div>
          {rows.map((row) =>
            row.mine_pending ? (
              <div key={row.id} className="t-row">
                <Dot color={colorToken(row.color)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{row.name}</span>
                  <span className="block truncate text-xs text-muted">
                    Invitation from {creatorName(row)}
                  </span>
                </span>
                <button
                  type="button"
                  className="t-chip t-tap44 text-accent"
                  disabled={busy}
                  onClick={() => void answer(row, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="t-chip t-tap44"
                  disabled={busy}
                  onClick={() => setDeclining(row)}
                >
                  Decline
                </button>
              </div>
            ) : (
              <button
                key={row.id}
                type="button"
                className="t-row w-full text-left"
                onClick={() => setOpenId(row.id)}
              >
                <Dot color={colorToken(row.color)} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{row.name}</span>
                  <span className="block truncate text-xs text-muted">{membersText(row)}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
              </button>
            )
          )}
        </div>

        <p className="t-note mt-3">{PRIVACY}</p>

        <button
          type="button"
          className="t-btn t-btn-primary mt-4 w-full"
          onClick={() => setCreating(true)}
        >
          Create a shared calendar
        </button>
      </Sheet>

      {creating && (
        <CreateSheet
          friends={friends}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            reload()
          }}
        />
      )}

      {open !== null && (
        <SettingsSheet
          me={me}
          row={open}
          friends={friends}
          onClose={() => setOpenId(null)}
          onChanged={reload}
          onLeft={() => {
            setOpenId(null)
            reload()
          }}
        />
      )}

      <ConfirmSheet
        open={declining !== null}
        label="Decline calendar"
        question={declining === null ? '' : `Decline ${declining.name}?`}
        note="The invitation goes, and they would have to share it again."
        verb="Decline"
        busy={busy}
        onConfirm={() => declining !== null && void answer(declining, false)}
        onClose={() => setDeclining(null)}
      />
    </>
  )
}

// A new shared calendar. One friend goes on it at the start: a shared calendar
// nobody else is on is the personal one with extra steps.
function CreateSheet({
  friends,
  onClose,
  onCreated,
}: {
  friends: MemberRow[]
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState<PaletteKey>('blue')
  const [friendId, setFriendId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') {
      setError(NEEDS_NAME)
      return
    }
    if (friendId === null) {
      setError(NEEDS_FRIEND)
      return
    }
    setSaving(true)
    setError('')
    try {
      await createCalendar({ name: name.trim(), color, friend_id: friendId })
      onCreated()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet open label="Create a shared calendar" tall onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <p className="mb-3 text-base font-semibold">Create a shared calendar</p>

        <div className="mb-3">
          <label className="t-label" htmlFor="calendar-name">
            Name
          </label>
          <input
            id="calendar-name"
            className="t-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <p className="t-label">Color</p>
        <Swatches value={color} onPick={setColor} />

        <p className="t-label mt-3">Share with</p>
        <FriendRows
          friends={friends}
          chosen={friendId === null ? [] : [friendId]}
          empty={NO_FRIENDS}
          onPick={setFriendId}
        />

        {error !== '' && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={saving}>
          Create
        </button>
      </form>
    </Sheet>
  )
}

// One shared calendar, as everybody on it can change it: its name, its colour,
// and who else is on it. Leaving is here too, because this is where somebody
// who wants out is already looking.
function SettingsSheet({
  me,
  row,
  friends,
  onClose,
  onChanged,
  onLeft,
}: {
  me: Me
  row: SharedCalendar
  friends: MemberRow[]
  onClose: () => void
  onChanged: () => void
  onLeft: () => void
}) {
  const [name, setName] = useState(row.name)
  const save = useInstantSave()
  const [adding, setAdding] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [removing, setRemoving] = useState<{ id: number; display_name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // What the server last took, so a blur straight after an enter does not send
  // the same name twice.
  const sent = useRef(row.name)

  const mine = row.created_by === me.id
  const onIt = new Set(row.members.map((one) => one.id))
  // A member's picture is whatever the friends list already carries for them,
  // and this account's own is on the account.
  const faceOf = (id: number): string | null =>
    id === me.id ? me.avatar_url : (friends.find((one) => one.id === id)?.avatar_url ?? null)

  const commitName = () => {
    const next = name.trim()
    if (next === '' || next === sent.current) return
    const was = sent.current
    sent.current = next
    save.run(async () => {
      try {
        await patchCalendar(row.id, { name: next })
        onChanged()
      } catch (failure) {
        sent.current = was
        setName(was)
        throw failure
      }
    })
  }

  const pickColor = (key: PaletteKey) =>
    save.run(async () => {
      await patchCalendar(row.id, { color: key })
      onChanged()
    })

  const act = async (run: () => Promise<unknown>, done: () => void) => {
    setBusy(true)
    setError('')
    try {
      await run()
      done()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>
      <Sheet open label={row.name} tall onClose={onClose}>
        <div className="mb-3 flex min-h-7 items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-base font-semibold">{row.name}</p>
          {save.saved && <span className="t-chip text-accent">Saved.</span>}
        </div>

        <div className="mb-3">
          <label className="t-label" htmlFor="calendar-settings-name">
            Name
          </label>
          <input
            id="calendar-settings-name"
            className="t-input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => event.key === 'Enter' && commitName()}
          />
        </div>

        <p className="t-label">Color</p>
        <Swatches value={row.color as PaletteKey} onPick={pickColor} />

        <p className="t-label mt-3">Members</p>
        <div>
          {row.members.map((one) => (
            <div key={one.id} className="t-row">
              <Avatar url={faceOf(one.id)} name={one.display_name} />
              <span className="min-w-0 flex-1 truncate text-sm">{one.display_name}</span>
              {!one.accepted && <span className="t-chip shrink-0">Waiting</span>}
              {mine && one.id !== me.id && (
                <button
                  type="button"
                  className="t-chip t-tap44 shrink-0"
                  disabled={busy}
                  onClick={() => setRemoving({ id: one.id, display_name: one.display_name })}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {save.error !== '' && <p className="t-error mt-2">{save.error}</p>}
        {error !== '' && <p className="t-error mt-2">{error}</p>}

        <button
          type="button"
          className="t-btn mt-4 w-full"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          Add a friend
        </button>
        <button
          type="button"
          className="t-btn mt-2 w-full"
          disabled={busy}
          onClick={() => setLeaving(true)}
        >
          Leave this calendar
        </button>
      </Sheet>

      {adding && (
        <Sheet open label="Add a friend" tall onClose={() => setAdding(false)}>
          <p className="mb-3 text-base font-semibold">Add a friend</p>
          <FriendRows
            friends={friends.filter((friend) => !onIt.has(friend.id))}
            chosen={[]}
            empty={
              friends.length === 0
                ? NO_FRIENDS
                : 'Everybody you share with is already on this calendar.'
            }
            onPick={(id) =>
              void act(
                () => addCalendarMember(row.id, id),
                () => {
                  setAdding(false)
                  onChanged()
                }
              )
            }
          />
          <button
            type="button"
            className="t-btn mt-4 w-full"
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </Sheet>
      )}

      <ConfirmSheet
        open={leaving}
        label="Leave calendar"
        question={`Leave ${row.name}?`}
        note="Your appointments stay on your personal calendar and leave this one."
        verb="Leave"
        busy={busy}
        onConfirm={() => void act(() => removeCalendarMember(row.id, me.id), onLeft)}
        onClose={() => setLeaving(false)}
      />

      <ConfirmSheet
        open={removing !== null}
        label="Remove member"
        question={removing === null ? '' : `Remove ${removing.display_name}?`}
        note="Their appointments come off this calendar. Yours stay."
        verb="Remove"
        busy={busy}
        onConfirm={() =>
          removing !== null &&
          void act(
            () => removeCalendarMember(row.id, removing.id),
            () => {
              setRemoving(null)
              onChanged()
            }
          )
        }
        onClose={() => setRemoving(null)}
      />
    </>
  )
}

// The eight colours, as the buttons they are picked from. Four to a row: all
// eight at 44px do not fit across a phone, and seven with one under them reads
// as an accident. The name is the label, because a colour with no name is
// nothing to a screen reader.
function Swatches({
  value,
  onPick,
}: {
  value: PaletteKey
  onPick: (key: PaletteKey) => void
}) {
  return (
    <div className="grid grid-cols-4 justify-items-center gap-2">
      {PALETTE.map((one) => (
        <button
          key={one.key}
          type="button"
          aria-label={one.label}
          aria-pressed={one.key === value}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line"
          style={{ background: one.token }}
          onClick={() => onPick(one.key)}
        >
          {one.key === value && (
            <Check className="h-5 w-5" style={{ color: 'var(--bg)' }} strokeWidth={3} />
          )}
        </button>
      ))}
    </div>
  )
}

// Who to share with, out of the friends this account has. One at a time: a
// calendar is made with one friend, and the rest are added to it afterwards.
function FriendRows({
  friends,
  chosen,
  empty,
  onPick,
}: {
  friends: MemberRow[]
  chosen: number[]
  // What an empty list means here, which is not the same question on the two
  // sheets that draw one.
  empty: string
  onPick: (id: number) => void
}) {
  if (friends.length === 0) {
    return <p className="text-sm text-muted">{empty}</p>
  }
  return (
    <div>
      {friends.map((friend) => (
        <button
          key={friend.id}
          type="button"
          aria-pressed={chosen.includes(friend.id)}
          className="t-row w-full text-left"
          onClick={() => onPick(friend.id)}
        >
          <Avatar url={friend.avatar_url} name={friend.display_name} />
          <span className="min-w-0 flex-1 truncate text-sm">{friend.display_name}</span>
          {chosen.includes(friend.id) && <span className="t-chip text-accent">Chosen</span>}
        </button>
      ))}
    </div>
  )
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  )
}
