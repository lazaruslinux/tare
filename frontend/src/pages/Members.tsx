import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  queryString,
  type FriendsPage,
  type MemberPage,
  type MemberRow,
} from '../api'
import { Avatar } from '../components/Avatar'
import { RoleMark } from '../components/RoleMark'
import { useTopBar } from '../hooks/useTopBar'

// Everybody in this Tare. One row each, and each row opens the profile that
// member chose to show. Nothing here is anybody's private business: a name, a
// picture, and what they have given the shared database. This is how people
// find each other, so it lists everybody and not only friends.

// The same wait as every other box that types as somebody types.
const DEBOUNCE = 250
const NOTHING = 'No matches.'

// What a row says a member has given, in words rather than a bare figure.
function countText(count: number): string {
  if (count === 0) return 'No contributions'
  return count === 1 ? '1 contribution' : `${count} contributions`
}

export function Members({
  me,
  onBack,
  onOpen,
  onAnswered,
}: {
  // Which row is this account's own, so it can say so.
  me: number
  onBack: () => void
  onOpen: (userId: number) => void
  // A request was answered here, so the feed and the badge above both move.
  onAnswered?: () => void
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<MemberRow[] | null>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  // Who has asked to be friends, and the tick that reads both lists again
  // after one of them is answered.
  const [incoming, setIncoming] = useState<MemberRow[]>([])
  const [again, setAgain] = useState(0)

  useEffect(() => {
    let alive = true
    api<FriendsPage>('/feed/friends')
      .then((page) => alive && setIncoming(page.incoming))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [again])

  // Answering moves the row out of the card above and the chip onto the row
  // below it, so both lists are read again.
  const answer = async (userId: number, agreed: boolean) => {
    setFailed('')
    try {
      await api(`/feed/friends/${userId}${agreed ? '/accept' : ''}`, {
        method: agreed ? 'POST' : 'DELETE',
      })
    } catch (failure) {
      setFailed(errorText(failure))
      return
    }
    setAgain((count) => count + 1)
    onAnswered?.()
  }

  // Each new word starts the list again rather than adding to the one under it.
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      setFailed('')
      api<MemberPage>(`/feed/members${queryString({ q: query.trim() })}`)
        .then((page) => {
          if (!alive) return
          setRows(page.items)
          setOffset(page.next_offset)
        })
        .catch((failure) => alive && setFailed(errorText(failure)))
    }, DEBOUNCE)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, again])

  useTopBar({ title: 'Members', back: { label: 'More', onBack } })

  const more = async () => {
    if (offset === null) return
    setBusy(true)
    try {
      const page = await api<MemberPage>(
        `/feed/members${queryString({ q: query.trim(), offset })}`
      )
      setRows((had) => [...(had ?? []), ...page.items])
      setOffset(page.next_offset)
    } catch (failure) {
      setFailed(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>
      {incoming.length > 0 && (
        <>
          <p className="t-micro mb-1">Requests</p>
          <div className="t-card mb-3">
            {incoming.map((row) => (
              <div key={row.id} className="t-row">
                <Avatar url={row.avatar_url} name={row.display_name} />
                <span className="min-w-0 flex-1 truncate text-sm">{row.display_name}</span>
                <button
                  type="button"
                  className="t-btn t-btn-primary shrink-0"
                  onClick={() => void answer(row.id, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="t-btn shrink-0"
                  onClick={() => void answer(row.id, false)}
                >
                  Decline
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <input
        className="t-input mb-3"
        type="search"
          autoComplete="off"
        placeholder="Type a name"
        aria-label="Search members"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {failed !== '' && <p className="t-error mb-3">{failed}</p>}
      {rows === null && failed === '' && <p className="text-sm text-muted">Loading.</p>}

      {rows !== null && rows.length === 0 && <p className="text-sm text-muted">{NOTHING}</p>}

      {rows !== null && rows.length > 0 && (
        <div className="t-card mb-3">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className="t-row w-full text-left"
              onClick={() => onOpen(row.id)}
            >
              <Avatar url={row.avatar_url} name={row.display_name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {row.display_name}
                  <RoleMark role={row.role} />
                </span>
                <span className="block text-xs text-muted">
                  {countText(row.contributions)}
                </span>
              </span>
              {row.id === me && <span className="t-chip">You</span>}
              {row.friend === true && <span className="t-chip shrink-0">Friends</span>}
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
            </button>
          ))}
        </div>
      )}

      {offset !== null && (
        <button
          className="t-btn mb-3 w-full"
          type="button"
          disabled={busy}
          onClick={() => void more()}
        >
          Show more
        </button>
      )}
    </>
  )
}
