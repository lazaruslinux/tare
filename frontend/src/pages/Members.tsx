import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, queryString, type MemberPage, type MemberRow } from '../api'
import { Avatar } from '../components/Avatar'
import { RoleMark } from '../components/RoleMark'
import { useTopBar } from '../hooks/useTopBar'

// Everybody in this Tare. One row each, and each row opens the profile that
// member chose to show. Nothing here is anybody's private business: a name, a
// picture, and what they have given the shared database.

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
}: {
  // Which row is this account's own, so it can say so.
  me: number
  onBack: () => void
  onOpen: (userId: number) => void
}) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<MemberRow[] | null>(null)
  const [offset, setOffset] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')

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
  }, [query])

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
