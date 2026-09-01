import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type AdminUser } from '../api'

// Who is on the instance, and how much each of them has put into the shared
// database. Read rather than acted on: nothing here changes an account.

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

  useEffect(() => {
    let alive = true
    api<AdminUser[]>('/admin/users')
      .then((rows) => alive && setPeople(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        More
      </button>
      <p className="mb-3 text-xl font-semibold tracking-tight">Members</p>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        {(people ?? []).map((person) => (
          <div key={person.id} className="t-row">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm">{person.display_name || person.username}</span>
                {person.is_admin && <span className="t-chip shrink-0">admin</span>}
              </span>
              <span className="block truncate text-xs text-muted">
                {person.username}, joined {joined(person.created_at)}
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
          <p className="text-sm text-muted">Nobody here yet.</p>
        )}
      </div>
    </>
  )
}
