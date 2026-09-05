import { useEffect, useState } from 'react'

import { api, errorText, type Me, type ReviewLogPage, type ReviewLogRow } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { clockText, dateText, useClock } from '../lib/clock'

// Everything anybody with a role has done to the shared database, newest
// first. An administrator's screen: a reviewer answers for their own work, and
// reading everybody's is the job of whoever handed the role out.

// What each action reads as in the middle of a sentence. A word rather than
// the column's own, because the row is read as "<name> approved <food>".
const SAID: Record<string, string> = {
  approved: 'approved',
  rejected: 'turned down',
  resolved: 'resolved the report on',
  food_edited: 'corrected',
  photo_replaced: 'changed a photo on',
  photo_removed: 'removed a photo from',
  role_granted: 'made a reviewer:',
  role_revoked: 'took the reviewer role from',
  applied: 'applied to review',
}

function sentence(row: ReviewLogRow): string {
  const said = SAID[row.action] ?? row.action
  // Applying is the one line that is about the person alone, so it does not
  // name a target after itself.
  if (row.action === 'applied') return `${row.actor_name} ${said}`
  return `${row.actor_name} ${said} ${row.target_name || 'something since deleted'}`
}

// The reason for a no, or the parts of a panel a correction moved. Nothing at
// all where the action speaks for itself.
function detailText(detail: ReviewLogRow['detail']): string | null {
  if (detail === null) return null
  if (Array.isArray(detail)) return detail.length === 0 ? null : `Changed: ${detail.join(', ')}`
  return detail.trim() === '' ? null : detail
}

export function ReviewLog({ me, onBack }: { me: Me; onBack: () => void }) {
  const [rows, setRows] = useState<ReviewLogRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Every row carries a stamp, so the list redraws when the clock changes.
  useClock()

  useTopBar({ title: 'Review log', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    api<ReviewLogPage>('/admin/review-log')
      .then((page) => {
        if (!alive) return
        setRows(page.items)
        setCursor(page.next_cursor)
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  const more = async () => {
    if (cursor === null) return
    setBusy(true)
    try {
      const page = await api<ReviewLogPage>(`/admin/review-log?cursor=${cursor}`)
      setRows((had) => [...(had ?? []), ...page.items])
      setCursor(page.next_cursor)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  if (error !== '') return <p className="t-error">{error}</p>
  if (rows === null) return <p className="text-sm text-muted">Loading.</p>
  if (rows.length === 0) {
    return <p className="text-sm text-muted">Nothing has been reviewed yet.</p>
  }

  return (
    <>
      <div className="t-card mb-3">
        {rows.map((row) => {
          const said = detailText(row.detail)
          return (
            <div key={row.id} className="t-row">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{sentence(row)}</span>
                {said !== null && <span className="block text-xs text-muted">{said}</span>}
                <span className="block text-xs text-muted">
                  {dateText(row.when, me.timezone)} {clockText(row.when, me.timezone)}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      {cursor !== null && (
        <button className="t-btn mb-3 w-full" type="button" disabled={busy} onClick={() => void more()}>
          Show more
        </button>
      )}
    </>
  )
}
