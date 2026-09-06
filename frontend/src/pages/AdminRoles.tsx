import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  queryString,
  type AdminUser,
  type AdminUserPage,
  type UserFilter,
} from '../api'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import { joined } from './AdminUsers'

// Who reviews, and who has asked to. One screen instead of a switch on every
// account: the question an administrator has is who reviews, and a list of
// everybody with a toggle beside each name answers a different one.

const PICKER = 'Add a reviewer'
const DEBOUNCE = 250
const NOBODY = 'Nobody reviews yet. Add a reviewer below.'
const NOTHING = 'No matches.'
const FROM_THE_SHELL = 'The administrator role is granted from the shell, never from here.'

// The three lists this screen is, read separately so each is the server's own
// answer rather than one list sorted here.
type Lists = { waiting: AdminUser[]; reviewers: AdminUser[]; admins: AdminUser[] }

function shownName(person: AdminUser): string {
  return person.display_name || person.username
}

function slice(role: UserFilter): Promise<AdminUser[]> {
  return api<AdminUserPage>(`/admin/users${queryString({ role })}`).then((page) => page.items)
}

async function readAll(): Promise<Lists> {
  const [waiting, reviewers, admins] = await Promise.all([
    slice('requested'),
    slice('reviewer'),
    slice('admin'),
  ])
  return { waiting, reviewers, admins }
}

export function AdminRoles({ onBack }: { onBack: () => void }) {
  const [lists, setLists] = useState<Lists | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  // The two questions this screen asks before it acts, each naming the person.
  const [demoting, setDemoting] = useState<AdminUser | null>(null)
  const [promoting, setPromoting] = useState<AdminUser | null>(null)

  const [picking, setPicking] = useState(false)
  const [find, setFind] = useState('')
  const [found, setFound] = useState<AdminUser[] | null>(null)
  const [pickError, setPickError] = useState('')

  useTopBar({ title: 'Roles', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    readAll()
      .then((read) => alive && setLists(read))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  // The picker's box types as somebody types. With nothing in it the list is
  // the newest accounts, so the sheet opens on something to tap.
  useEffect(() => {
    if (!picking) return
    let alive = true
    const timer = window.setTimeout(() => {
      setPickError('')
      api<AdminUserPage>(`/admin/users${queryString({ q: find.trim() })}`)
        .then((page) => alive && setFound(page.items))
        .catch((failure) => alive && setPickError(errorText(failure)))
    }, DEBOUNCE)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [picking, find])

  // Drawn at once and put back if the server refuses. Waiting on a round trip
  // to see a row move reads as a button that did nothing.
  const decide = async (person: AdminUser, next: boolean) => {
    const was = lists
    setError('')
    setNote('')
    setLists((had) =>
      had === null
        ? had
        : {
            waiting: had.waiting.filter((row) => row.id !== person.id),
            reviewers: next
              ? [...had.reviewers, { ...person, role: 'reviewer' as const, requested: false }]
              : had.reviewers.filter((row) => row.id !== person.id),
            admins: had.admins,
          }
    )
    try {
      await api(`/admin/users/${person.id}`, { method: 'PATCH', body: { is_reviewer: next } })
    } catch (failure) {
      setError(errorText(failure))
      setLists(was)
    }
  }

  // Picked out of the sheet, which closes on the answer and leaves the list
  // saying who reviews now.
  const add = async (person: AdminUser) => {
    setPickError('')
    try {
      await api(`/admin/users/${person.id}`, { method: 'PATCH', body: { is_reviewer: true } })
      setPicking(false)
      setFind('')
      setFound(null)
      setError('')
      setNote(`${shownName(person)} reviews now.`)
      setLists(await readAll())
    } catch (failure) {
      setPickError(errorText(failure))
    }
  }

  if (error !== '' && lists === null) return <p className="t-error">{error}</p>
  if (lists === null) return <p className="text-sm text-muted">Loading.</p>

  // Somebody who already reviews, or reviews by being an administrator, is not
  // somebody to add.
  const addable = (found ?? []).filter((row) => !row.is_admin && row.role !== 'reviewer')

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}
      {note && <p className="mb-3 text-sm text-muted">{note}</p>}

      {lists.waiting.length > 0 && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Waiting</p>
          {lists.waiting.map((person) => (
            <div key={person.id} className="t-row flex-col items-stretch gap-2">
              <p className="truncate text-sm">{shownName(person)}</p>
              <p className="truncate text-xs text-muted">
                {person.username}
                {person.requested_at !== null && `, applied ${joined(person.requested_at)}`}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="t-btn t-btn-primary flex-1"
                  onClick={() => setPromoting(person)}
                >
                  Make a reviewer
                </button>
                <button
                  type="button"
                  className="t-btn flex-1"
                  onClick={() => void decide(person, false)}
                >
                  Not now
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Reviewers</p>
        {lists.reviewers.map((person) => (
          <div key={person.id} className="t-row">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{shownName(person)}</span>
              <span className="block truncate text-xs text-muted">
                {person.username}, joined {joined(person.created_at)}
              </span>
            </span>
            <button
              type="button"
              className="shrink-0 text-sm font-semibold text-danger"
              onClick={() => setDemoting(person)}
            >
              Remove
            </button>
          </div>
        ))}
        {lists.reviewers.length === 0 && <p className="text-sm text-muted">{NOBODY}</p>}
        <button
          type="button"
          className="t-btn t-btn-primary mt-3 w-full"
          onClick={() => setPicking(true)}
        >
          {PICKER}
        </button>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Administrators</p>
        {lists.admins.map((person) => (
          <div key={person.id} className="t-row">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{shownName(person)}</span>
              <span className="block truncate text-xs text-muted">{person.username}</span>
            </span>
          </div>
        ))}
        <p className="mt-2 text-xs text-muted">{FROM_THE_SHELL}</p>
      </div>

      <Sheet open={picking} label={PICKER} top tall onClose={() => setPicking(false)}>
        <p className="t-micro mb-2">{PICKER}</p>
        {/* Nothing here may read as a sign-in field, or a phone offers its
            saved passwords over the keyboard: no autofill, and no "username"
            in the hint. */}
        <input
          className="t-input mb-3"
          type="search"
          name="find-member"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder="Type a name"
          aria-label={PICKER}
          value={find}
          onChange={(event) => setFind(event.target.value)}
        />
        {pickError && <p className="t-error mb-3">{pickError}</p>}
        {found !== null && addable.length === 0 && (
          <p className="mb-3 text-sm text-muted">{NOTHING}</p>
        )}
        {addable.map((person) => (
          <button
            key={person.id}
            type="button"
            className="t-row w-full text-left"
            onClick={() => setPromoting(person)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{shownName(person)}</span>
              <span className="block truncate text-xs text-muted">{person.username}</span>
            </span>
          </button>
        ))}
      </Sheet>

      <Sheet
        open={demoting !== null}
        label="Demote to member"
        center
        onClose={() => setDemoting(null)}
      >
        {demoting && (
          <>
            <p className="text-base font-semibold">Demote {shownName(demoting)} to member?</p>
            <p className="mt-2 text-sm text-muted">They will not receive a notification.</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="t-btn t-btn-danger flex-1"
                onClick={() => {
                  const person = demoting
                  setDemoting(null)
                  void decide(person, false)
                }}
              >
                Demote
              </button>
              <button type="button" className="t-btn" onClick={() => setDemoting(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={promoting !== null}
        label="Promote to reviewer"
        center
        onClose={() => setPromoting(null)}
      >
        {promoting && (
          <>
            <p className="text-base font-semibold">Promote {shownName(promoting)} to Reviewer?</p>
            <p className="mt-2 text-sm text-muted">
              They will be allowed to review &amp; approve item submissions for Tare. This can be
              undone.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="t-btn t-btn-primary flex-1"
                onClick={() => {
                  const person = promoting
                  setPromoting(null)
                  // From the picker the whole screen is re-read; from the
                  // waiting list the row moves at once.
                  void (picking ? add(person) : decide(person, true))
                }}
              >
                Promote
              </button>
              <button type="button" className="t-btn" onClick={() => setPromoting(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}
