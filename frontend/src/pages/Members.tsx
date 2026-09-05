import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type MemberRow } from '../api'
import { Avatar } from '../components/Avatar'
import { RoleMark } from '../components/RoleMark'
import { useTopBar } from '../hooks/useTopBar'

// Everybody in this Tare. One row each, and each row opens the profile that
// member chose to show. Nothing here is anybody's private business: a name, a
// picture, and what they have given the shared database.

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
  const [rows, setRows] = useState<MemberRow[] | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    api<{ items: MemberRow[] }>('/feed/members')
      .then((page) => alive && setRows(page.items))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  useTopBar({ title: 'Members', back: { label: 'More', onBack } })

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (rows === null) return <p className="text-sm text-muted">Loading.</p>

  return (
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
              {row.submitted} submitted &middot; {row.approved} approved
            </span>
          </span>
          {row.id === me && <span className="t-chip">You</span>}
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}
