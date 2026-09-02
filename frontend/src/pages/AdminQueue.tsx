import { useEffect, useState } from 'react'

import { ApiError, api, errorText, type Food, type Proposed, type QueueItem } from '../api'
import { FoodForm } from '../components/FoodForm'
import { useTopBar } from '../hooks/useTopBar'
import { KIND_LABEL, SHARED_FACTS } from '../lib/community'

// The queue, which is the only door into the shared database. It is read dense
// on purpose: whoever is here is comparing ten numbers against a photograph of
// a label, and a screen that shows four of them at a time makes that harder.

// What each kind of request is called on screen, in the words a reviewer would
// use for it rather than the words the column stores.
// Said instead of the server's own sentence, because a reviewer looking at a
// conflict needs the next move rather than the reason.
const DUPLICATE =
  'Another approved food already has this barcode. Reject this one as a duplicate.'

function nutrientText(key: string, value: number | null): string {
  if (value === null) return '-'
  return String(key === 'calories' ? Math.round(value) : Math.round(value * 10) / 10)
}

function servingText(food: Proposed, index: number): string {
  const serving = food.servings[index]
  return serving ? `${serving.name}, ${serving.base_amount} ${food.base_unit}` : '-'
}

type Line = { label: string; now: string; proposed: string }

// The two panels as one list of lines, so a correction is read down a column
// rather than by holding two cards side by side in your head.
function comparison(now: Proposed, proposed: Proposed): Line[] {
  const lines: Line[] = [
    { label: 'Name', now: now.name, proposed: proposed.name },
    { label: 'Brand', now: now.brand || '-', proposed: proposed.brand || '-' },
    { label: 'Measured in', now: now.base_unit, proposed: proposed.base_unit },
  ]
  for (const fact of SHARED_FACTS) {
    lines.push({
      label: fact.unit ? `${fact.label} (${fact.unit})` : fact.label,
      now: nutrientText(fact.key, now[fact.key]),
      proposed: nutrientText(fact.key, proposed[fact.key]),
    })
  }
  const most = Math.max(now.servings.length, proposed.servings.length)
  for (let index = 0; index < most; index += 1) {
    lines.push({
      label: `Serving ${index + 1}`,
      now: servingText(now, index),
      proposed: servingText(proposed, index),
    })
  }
  return lines
}

function Panel({ food }: { food: Proposed }) {
  return (
    <>
      <p className="t-micro mt-3 mb-1">Per 100 {food.base_unit}</p>
      <div className="grid grid-cols-2 gap-x-4">
        {SHARED_FACTS.map((fact) => (
          <div key={fact.key} className="t-row min-h-8 text-sm">
            <span className="flex-1 text-muted">{fact.label}</span>
            <span className="t-nums">
              {nutrientText(fact.key, food[fact.key])} {fact.unit}
            </span>
          </div>
        ))}
      </div>

      <p className="t-micro mt-3 mb-1">Servings</p>
      {food.servings.map((serving, index) => (
        <div key={index} className="t-row min-h-8 text-sm">
          <span className="flex-1 text-muted">{serving.name}</span>
          <span className="t-nums">
            {serving.base_amount} {food.base_unit}
          </span>
        </div>
      ))}
    </>
  )
}

function Comparison({
  now,
  proposed,
  showAll,
  onShowAll,
}: {
  now: Proposed
  proposed: Proposed
  showAll: boolean
  onShowAll: () => void
}) {
  const lines = comparison(now, proposed)
  const changed = lines.filter((line) => line.now !== line.proposed)
  const shown = showAll ? lines : changed

  return (
    <>
      <p className="t-micro mt-3 mb-1">
        {changed.length === 0 ? 'Nothing changed' : `${changed.length} changed`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="t-micro py-1 text-left">Field</th>
              <th className="t-micro py-1 text-right">Now</th>
              <th className="t-micro py-1 text-right">Proposed</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((line) => {
              const moved = line.now !== line.proposed
              return (
                <tr key={line.label} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-muted">{line.label}</td>
                  <td className="t-nums py-1.5 pr-3 text-right text-muted">{line.now}</td>
                  <td className={`t-nums py-1.5 text-right ${moved ? 'text-accent' : ''}`}>
                    {line.proposed}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!showAll && changed.length < lines.length && (
        <button type="button" className="t-micro mt-2" onClick={onShowAll}>
          Show unchanged
        </button>
      )}
    </>
  )
}

export function AdminQueue({
  onBack,
  onDecided,
}: {
  onBack: () => void
  // Each decision changes the waiting count the header shows, so it is told.
  onDecided: () => void
}) {
  const [queue, setQueue] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // The photo somebody tapped, shown whole rather than as a sixty-pixel square.
  const [looking, setLooking] = useState<string | null>(null)
  // Which item a reason is being written for, and what has been written.
  const [rejecting, setRejecting] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [keepPhoto, setKeepPhoto] = useState<Record<number, boolean>>({})
  const [showAll, setShowAll] = useState<Record<number, boolean>>({})
  // The proposal being corrected before it is decided, loaded whole so the
  // form has its servings as well as its panel.
  const [adjusting, setAdjusting] = useState<Food | null>(null)

  // The form names itself while a proposal is being corrected.
  useTopBar(
    adjusting === null ? { title: 'Review queue', back: { label: 'More', onBack } } : null
  )

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
      onDecided()
    } catch (failure) {
      const clash = path === 'approve' && failure instanceof ApiError && failure.status === 409
      setError(clash ? DUPLICATE : errorText(failure))
    }
    setBusy(false)
  }

  const adjust = async (foodId: number) => {
    setBusy(true)
    setError('')
    try {
      setAdjusting(await api<Food>(`/foods/${foodId}`))
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  if (adjusting !== null) {
    return (
      <FoodForm
        food={adjusting}
        title="Adjust proposal"
        backLabel="Review queue"
        complete
        onSaved={() => {
          setAdjusting(null)
          void load()
        }}
        onCancel={() => setAdjusting(null)}
      />
    )
  }

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      {queue !== null && queue.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing waiting.</p>
        </div>
      )}

      {(queue ?? []).map((item) => {
        const about = item.kind === 'new' ? item.food : item.target
        // Held in a const so the buttons below narrow it too: a closure does
        // not keep the narrowing a JSX guard gave.
        const proposal = item.food
        return (
          <div key={item.id} className="t-card mb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight">
                  {about?.name ?? 'A deleted food'}
                </p>
                <p className="truncate text-sm text-muted">{about?.brand || 'No brand'}</p>
                {item.kind === 'new' && item.food?.barcode && (
                  <p className="t-nums text-xs text-muted">{item.food.barcode}</p>
                )}
              </div>
              <span className="t-chip shrink-0">{KIND_LABEL[item.kind] ?? item.kind}</span>
            </div>

            <p className="mt-2 text-xs text-muted">
              From {item.submitted_by ?? 'a closed account'}
            </p>
            {item.note && <p className="mt-1 text-sm">{item.note}</p>}

            {item.kind === 'new' && proposal && (
              <>
                {item.photo_url && (
                  <button
                    type="button"
                    className="mt-3 block"
                    aria-label="Look at the label"
                    onClick={() => setLooking(item.photo_url)}
                  >
                    <img
                      src={item.photo_url}
                      alt={`The label for ${proposal.name}`}
                      className="h-24 w-24 rounded-lg border border-line object-cover"
                    />
                  </button>
                )}
                <Panel food={proposal} />
              </>
            )}

            {item.kind === 'edit' && proposal && item.current && (
              <>
                <Comparison
                  now={item.current}
                  proposed={proposal}
                  showAll={showAll[item.id] ?? false}
                  onShowAll={() => setShowAll({ ...showAll, [item.id]: true })}
                />
                <button
                  type="button"
                  className="t-btn mt-3 w-full"
                  disabled={busy}
                  onClick={() => adjust(proposal.id)}
                >
                  Adjust
                </button>
              </>
            )}

            {item.kind === 'photo' && (
              <div className="mt-3 flex gap-3">
                <div className="min-w-0 flex-1">
                  <p className="t-micro mb-1">Now</p>
                  {item.current_photo_url ? (
                    <button
                      type="button"
                      className="block w-full"
                      aria-label="Look at the picture it has now"
                      onClick={() => setLooking(item.current_photo_url)}
                    >
                      <img
                        src={item.current_photo_url}
                        alt="The picture this food has now"
                        className="h-36 w-full rounded-lg border border-line object-cover"
                      />
                    </button>
                  ) : (
                    <p className="text-sm text-muted">No picture yet.</p>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="t-micro mb-1">Proposed</p>
                  {item.photo_url && (
                    <button
                      type="button"
                      className="block w-full"
                      aria-label="Look at the picture being offered"
                      onClick={() => setLooking(item.photo_url)}
                    >
                      <img
                        src={item.photo_url}
                        alt="The picture being offered"
                        className="h-36 w-full rounded-lg border border-line object-cover"
                      />
                    </button>
                  )}
                </div>
              </div>
            )}

            {item.kind === 'new' && item.photo_url && (
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
                    decide(
                      item.id,
                      'approve',
                      item.kind === 'new' ? { keep_photo: keepPhoto[item.id] ?? true } : {}
                    )
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
        )
      })}

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
