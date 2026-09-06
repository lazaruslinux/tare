import { useEffect, useState } from 'react'

import { api, errorText, type AdminUser } from '../api'
import { Switch } from '../components/Switch'
import { useTopBar } from '../hooks/useTopBar'

// Who is on the instance, and how much each of them has put into the shared
// database. The one thing that can be changed from here is the reviewer role:
// there is no path to an administrator in either direction.

function joined(when: string): string {
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
  const [people, setPeople] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState('')

  useTopBar({ title: 'Member accounts', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    api<AdminUser[]>('/admin/users')
      .then((rows) => alive && setPeople(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  // Drawn at once and put back if the server refuses. The switch is a small
  // answer to a small question, and waiting on a round trip to see it move
  // reads as a switch that does not work.
  const setReviewer = async (person: AdminUser, next: boolean) => {
    setError('')
    const was = people
    setPeople(
      (rows) =>
        rows?.map((row) =>
          row.id === person.id
            ? { ...row, role: next ? 'reviewer' : null, requested: next ? false : row.requested }
            : row
        ) ?? rows
    )
    try {
      await api(`/admin/users/${person.id}`, {
        method: 'PATCH',
        body: { is_reviewer: next },
      })
    } catch (failure) {
      setError(errorText(failure))
      setPeople(was)
    }
  }

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        {(people ?? []).map((person) => (
          <div key={person.id}>
            <div className="t-row">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm">
                    {person.display_name || person.username}
                  </span>
                  {person.is_admin && <span className="t-chip shrink-0">admin</span>}
                  {/* They have put their name forward and nobody has answered
                      yet, which is what the switch beside this is for. */}
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
            {person.is_admin ? (
              // An administrator reviews by being one, and is not demoted here.
              <div className="t-row">
                <span className="flex-1 text-sm text-muted">Administrator</span>
              </div>
            ) : (
              <Switch
                label="Reviewer"
                checked={person.role === 'reviewer'}
                onChange={(next) => void setReviewer(person, next)}
              />
            )}
          </div>
        ))}
        {people !== null && people.length === 0 && (
          <p className="text-sm text-muted">Nobody here yet.</p>
        )}
      </div>
    </>
  )
}
