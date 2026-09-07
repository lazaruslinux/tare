import { useEffect, useState, type ReactNode } from 'react'

import { api, errorText, type MemberView as Member } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { Avatar } from './Avatar'
import { Verified } from './FoodRows'
import { RoleMark } from './RoleMark'
import { Sheet } from './Sheet'
import { roleLabel } from '../lib/roles'

// One member, as another member sees them, and the one control over whether
// the two of them are friends. Whatever is not here is not being withheld
// politely: it never left their account, or they have not added you.

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
  onChange,
}: {
  userId: number
  // The screen this was opened from, which is what the way back is called.
  back: string
  onBack: () => void
  // A friendship started or ended here, which changes the feed and the count
  // of requests waiting. Absent where nothing above this is listening.
  onChange?: () => void
}) {
  const [member, setMember] = useState<Member | null>(null)
  const [failed, setFailed] = useState('')
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState('')
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let alive = true
    api<Member>(`/feed/members/${userId}`)
      .then((row) => alive && setMember(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [userId])

  // Every one of the five buttons is the same two steps: the call, then this
  // member read again, because the server decides what the two of them are now.
  const act = async (path: string, method: string) => {
    setBusy(true)
    setRefused('')
    try {
      await api(path, { method })
      setMember(await api<Member>(`/feed/members/${userId}`))
      onChange?.()
    } catch (failure) {
      setRefused(errorText(failure))
    }
    setBusy(false)
  }

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

  const standing = member.friendship
  return (
    <>
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
        {/* What this account can do about the two of them, which is one thing at
            a time: nothing is offered on your own page. */}
        {standing !== 'self' && (
          <div className="mt-3">
            {standing === 'none' && (
              <button
                type="button"
                className="t-btn t-btn-primary w-full"
                disabled={busy}
                onClick={() => void act(`/feed/friends/${userId}`, 'POST')}
              >
                Add friend
              </button>
            )}
            {standing === 'requested' && (
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm text-muted">Request sent</span>
                <button
                  type="button"
                  className="t-link"
                  disabled={busy}
                  onClick={() => void act(`/feed/friends/${userId}`, 'DELETE')}
                >
                  Cancel request
                </button>
              </div>
            )}
            {standing === 'incoming' && (
              <div className="flex gap-3">
                <button
                  type="button"
                  className="t-btn t-btn-primary flex-1"
                  disabled={busy}
                  onClick={() => void act(`/feed/friends/${userId}/accept`, 'POST')}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="t-btn"
                  disabled={busy}
                  onClick={() => void act(`/feed/friends/${userId}`, 'DELETE')}
                >
                  Decline
                </button>
              </div>
            )}
            {standing === 'friends' && (
              <div className="flex items-center justify-between gap-3">
                <span className="t-chip">Friends</span>
                <button
                  type="button"
                  className="t-link"
                  disabled={busy}
                  onClick={() => setRemoving(true)}
                >
                  Remove friend
                </button>
              </div>
            )}
            {refused !== '' && <p className="t-error mt-3">{refused}</p>}
          </div>
        )}
      </div>

      <Sheet open={removing} label="Remove friend" center onClose={() => setRemoving(false)}>
        <p className="text-base font-semibold">Remove {member.display_name} as a friend?</p>
        <p className="mt-2 text-sm text-muted">They will not receive a notification.</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-danger flex-1"
            onClick={() => {
              setRemoving(false)
              void act(`/feed/friends/${userId}`, 'DELETE')
            }}
          >
            Remove
          </button>
          <button type="button" className="t-btn" onClick={() => setRemoving(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
    </>
  )
}
