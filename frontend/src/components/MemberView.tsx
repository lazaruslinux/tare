import { useEffect, useState, type ReactNode } from 'react'

import { api, errorText, type MemberView as Member } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { Avatar } from './Avatar'
import { Verified } from './FoodRows'
import { RoleMark } from './RoleMark'
import { roleLabel } from '../lib/roles'

// One member, as other members see them. Whatever is not here is not being
// withheld politely: it never left their account.

const SEX_LABEL: Record<string, string> = { female: 'Female', male: 'Male' }

function monthText(stamp: string): string {
  const at = new Date(`${stamp}-01T00:00:00Z`)
  return at.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' })
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="t-row">
      <span className="flex-1 text-sm">{label}</span>
      <span className="flex items-center gap-1.5 text-right text-sm text-muted">{value}</span>
    </div>
  )
}

export function MemberView({
  userId,
  back,
  onBack,
}: {
  userId: number
  // The screen this was opened from, which is what the way back is called.
  back: string
  onBack: () => void
}) {
  const [member, setMember] = useState<Member | null>(null)
  const [failed, setFailed] = useState('')

  useEffect(() => {
    let alive = true
    api<Member>(`/feed/members/${userId}`)
      .then((row) => alive && setMember(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [userId])

  useTopBar({
    title: member?.display_name ?? 'Member',
    back: { label: back, onBack },
  })

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (member === null) return <p className="text-sm text-muted">Loading.</p>

  const whoLine = [
    member.sex === undefined ? null : (SEX_LABEL[member.sex] ?? member.sex),
    member.age === undefined ? null : String(member.age),
  ]
    .filter((part) => part !== null)
    .join(', ')

  return (
    <div className="t-card mb-3">
      <div className="mb-3 flex items-center gap-3">
        <Avatar url={member.avatar_url} name={member.display_name} size="page" />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">
            {member.display_name}
            <RoleMark role={member.role} />
          </p>
          {/* The shield says there is a role; this says which one. */}
          {roleLabel(member.role) !== null && (
            <p className="text-xs text-muted">{roleLabel(member.role)}</p>
          )}
          {/* What they chose to share, said the way a person would: "Male, 33",
              then where they live. Nothing shared, nothing said. */}
          {whoLine !== '' && <p className="text-sm text-muted">{whoLine}</p>}
          {member.location !== undefined && (
            <p className="text-sm text-muted">{member.location}</p>
          )}
          <p className="t-micro mt-1">Member since {monthText(member.member_since)}</p>
        </div>
      </div>
      {/* The same mark an approved food wears, so the number is read as
          foods that are in the shared database. */}
      <Fact
        label="Contributions"
        value={
          <>
            <Verified />
            {member.contributions}
          </>
        }
      />
    </div>
  )
}
