import { useEffect, useState } from 'react'

import { api, errorText, queryString, type AdminUser, type AdminUserPage } from '../api'
import { useTopBar } from '../hooks/useTopBar'

// Who is on the instance, and how much each of them has put into the shared
// database. Read only: the reviewer role is handed out on the Roles screen,
// where the whole list of who reviews is on one page.

// How long the box waits after the last keystroke. Long enough that typing a
// name is one request rather than six.
const DEBOUNCE = 250
const NOTHING = 'Nobody matches that.'

export function joined(when: string): string {
  return new Date(when).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function Count({ label, total }: { label: string; total: number }) {
  return (
    <span className="text-xs text-muted">
      <span className="t-nums text-text">{total}</span> {label}
    </span>
  )
}

export function AdminUsers({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [people, setPeople] = useState<AdminUser[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useTopBar({ title: 'Member accounts', back: { label: 'More', onBack } })

  // The box types as somebody types, and each new word starts the list again
  // rather than adding to the one below it.
  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      setError('')
      api<AdminUserPage>(`/admin/users${queryString({ q: query.trim() })}`)
        .then((page) => {
          if (!alive) return
          setPeople(page.items)
          setCursor(page.next_cursor)
        })
        .catch((failure) => alive && setError(errorText(failure)))
    }, DEBOUNCE)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    try {
      const page = await api<AdminUserPage>(
        `/admin/users${queryString({ q: query.trim(), cursor })}`
      )
      setPeople((had) => [...(had ?? []), ...page.items])
      setCursor(page.next_cursor)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>
      <input
        className="t-input mb-3"
        type="search"
        placeholder="Name or username"
        aria-label="Search member accounts"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        {(people ?? []).map((person) => (
          <div key={person.id} className="t-row">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm">{person.display_name || person.username}</span>
                {person.is_admin && <span className="t-chip shrink-0">admin</span>}
                {/* They have put their name forward and nobody has answered
                    yet, which is what the Roles screen is for. */}
                {person.requested && <span className="t-chip shrink-0">Applied to review</span>}
                {/* Sitting behind the verify screen, or on an instance that
                    sends no mail, never asked to answer one. */}
                {(person.email === null || !person.email_verified) && (
                  <span className="t-chip shrink-0">Unverified</span>
                )}
              </span>
              <span className="block truncate text-xs text-muted">
                {person.username}, joined {joined(person.created_at)}
                {person.email !== null && `, ${person.email}`}
              </span>
              <span className="mt-1 flex flex-wrap gap-x-3">
                <Count label="waiting" total={person.submissions.pending} />
                <Count label="approved" total={person.submissions.approved} />
                <Count label="turned down" total={person.submissions.rejected} />
              </span>
            </span>
          </div>
        ))}
        {people !== null && people.length === 0 && (
          <p className="text-sm text-muted">{query.trim() === '' ? 'Nobody here yet.' : NOTHING}</p>
        )}
      </div>

      {cursor !== null && (
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
