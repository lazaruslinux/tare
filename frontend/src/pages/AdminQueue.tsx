import { ChevronLeft } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type QueueItem } from '../api'
import { SHARED_FACTS } from '../lib/community'

// The queue, which is the only door into the shared database. It is read dense
// on purpose: whoever is here is comparing ten numbers against a photograph of
// a label, and a screen that shows four of them at a time makes that harder.

function nutrientText(key: string, value: number | null): string {
  if (value === null) return '-'
  return String(key === 'calories' ? Math.round(value) : Math.round(value * 10) / 10)
}

export function AdminQueue({ onBack }: { onBack: () => void }) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The photo somebody tapped, shown whole rather than as a sixty-pixel square.
  const [looking, setLooking] = useState<string | null>(null)
  // Which item a reason is being written for, and what has been written.
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [keepPhoto, setKeepPhoto] = useState<Record<number, boolean>>({})

  const load = () =>
    api<QueueItem[]>('/admin/queue').then(setQueue, (failure) => {
      setError(errorText(failure))
      setQueue([])
    })

  useEffect(() => {
    let alive = true
    api<QueueItem[]>('/admin/queue')
      .then((rows) => alive && setQueue(rows))
      .catch((failure) => {
        if (!alive) return
        setError(errorText(failure))
        setQueue([])
      })
    return () => {
      alive = false
    }
  }, [])

  const decide = async (id: number, path: string, body: unknown) => {
    setBusy(true)
    setError('')
    try {
      await api(`/admin/queue/${id}/${path}`, { method: 'POST', body })
      setRejecting(null)
      setReason('')
      await load()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        More
      </button>
      <p className="mb-3 text-xl font-semibold tracking-tight">Review queue</p>

      {error && <p className="t-error mb-3">{error}</p>}

      {queue !== null && queue.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing waiting.</p>
        </div>
      )}

      {(queue ?? []).map((item) => (
        <div key={item.id} className="t-card mb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight">{item.food.name}</p>
              <p className="truncate text-sm text-muted">{item.food.brand || 'No brand'}</p>
              {item.food.barcode && (
                <p className="t-nums text-xs text-muted">{item.food.barcode}</p>
              )}
            </div>
            {item.photo_url && (
              <button
                type="button"
                className="shrink-0"
                aria-label="Look at the label"
                onClick={() => setLooking(item.photo_url)}
              >
                <img
                  src={item.photo_url}
                  alt={`The label for ${item.food.name}`}
                  className="h-16 w-16 rounded-lg border border-line object-cover"
                />
              </button>
            )}
          </div>

          <p className="mt-2 text-xs text-muted">
            From {item.submitted_by ?? 'a closed account'}
          </p>
          {item.note && <p className="mt-1 text-sm">{item.note}</p>}

          <p className="t-micro mt-3 mb-1">Per 100 {item.food.base_unit}</p>
          <div className="grid grid-cols-2 gap-x-4">
            {SHARED_FACTS.map((fact) => (
              <div key={fact.key} className="t-row min-h-8 text-sm">
                <span className="flex-1 text-muted">{fact.label}</span>
                <span className="t-nums">
                  {nutrientText(fact.key, item.food[fact.key])} {fact.unit}
                </span>
              </div>
            ))}
          </div>

          <p className="t-micro mt-3 mb-1">Servings</p>
          {item.food.servings.map((serving, index) => (
            <div key={index} className="t-row min-h-8 text-sm">
              <span className="flex-1 text-muted">{serving.name}</span>
              <span className="t-nums">
                {serving.base_amount} {item.food.base_unit}
              </span>
            </div>
          ))}

          {item.photo_url && (
            <label className="t-row text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={keepPhoto[item.id] ?? true}
                onChange={(event) =>
                  setKeepPhoto({ ...keepPhoto, [item.id]: event.target.checked })
                }
              />
              <span className="flex-1">Publish the photo with it</span>
            </label>
          )}

          {rejecting === item.id ? (
            <div className="mt-3">
              <label className="t-label" htmlFor={`reject-${item.id}`}>
                Why not, in a sentence
              </label>
              <input
                id={`reject-${item.id}`}
                className="t-input"
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  className="t-btn text-danger flex-1"
                  disabled={busy}
                  onClick={() => decide(item.id, 'reject', { note: reason })}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="t-btn"
                  onClick={() => {
                    setRejecting(null)
                    setReason('')
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                className="t-btn t-btn-primary flex-1"
                disabled={busy}
                onClick={() =>
                  decide(item.id, 'approve', { keep_photo: keepPhoto[item.id] ?? true })
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="t-btn"
                onClick={() => {
                  setRejecting(item.id)
                  setReason('')
                }}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}

      {looking && (
        <button
          type="button"
          aria-label="Close the label"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLooking(null)}
        >
          <img src={looking} alt="The label" className="max-h-full max-w-full rounded-xl" />
        </button>
      )}
    </>
  )
}
