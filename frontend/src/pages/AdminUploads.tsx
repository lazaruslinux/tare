import { useEffect, useState } from 'react'

import { api, errorText, type Upload } from '../api'
import { stampText, useClock } from '../lib/clock'
import { useTopBar } from '../hooks/useTopBar'

// Every health export that has been handed to this instance as a file. A file
// is the one thing here that arrives by hand and can carry anything, so who
// sent one, when, and how large it was is worth being able to read. What was
// inside it is not kept and is not here.

// Rounded to the unit somebody would say out loud, because the exact byte
// count of a file nobody can open says nothing.
function size(bytes: number | null): string {
  if (bytes === null) return 'unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AdminUploads({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Upload[] | null>(null)
  const [error, setError] = useState('')
  // Every row carries a stamp, so the list redraws when the clock changes.
  useClock()

  useTopBar({ title: 'Uploads', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    api<Upload[]>('/admin/uploads')
      .then((loaded) => alive && setRows(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        {rows !== null && rows.length === 0 && (
          <p className="text-sm text-muted">Nobody has uploaded a file.</p>
        )}
        {(rows ?? []).map((row) => (
          <div key={row.id} className="t-row">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{row.display_name || row.username}</span>
              <span className="block truncate text-xs text-muted">
                {stampText(row.received_at)} · {size(row.bytes)}
              </span>
            </span>
            <span className="t-nums shrink-0 text-right text-xs text-muted">
              <span className="block">{row.accepted} kept</span>
              <span className="block">
                {row.flagged} flagged · {row.skipped} skipped
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
