import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useState, type ChangeEvent } from 'react'

import {
  ApiError,
  api,
  errorText,
  foodPhoto,
  upload,
  type Food,
  type Me,
  type PhotoPurpose,
  type Proposed,
  type QueueItem,
} from '../api'
import { Lightbox } from '../components/Lightbox'
import { Fold } from '../components/NutritionLabel'
import { FoodForm } from '../components/FoodForm'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import {
  KIND_LABEL,
  MAX_PHOTO_BYTES,
  PHOTO_TOO_LARGE,
  SHARED_FACTS,
  sectionLabel,
} from '../lib/community'
import { scale } from '../lib/units'

// The queue, which is the only door into the shared database. It is read dense
// on purpose: whoever is here is comparing eleven numbers against a photograph of
// a label, and a screen that shows four of them at a time makes that harder.

// What each kind of request is called on screen, in the words a reviewer would
// use for it rather than the words the column stores.
// Said instead of the server's own sentence, because a reviewer looking at a
// conflict needs the next move rather than the reason.
const DUPLICATE =
  'Another approved food already has this barcode. Reject this one as a duplicate.'
// How the server opens the sentence for a request somebody else has answered.
// Read off the start of it, because the name that follows is the useful part.
const DECIDED_ALREADY = 'Already decided by'

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
    {
      label: 'Description',
      now: now.description || '-',
      proposed: proposed.description || '-',
    },
    {
      label: 'Section',
      now: sectionLabel(now.section),
      proposed: sectionLabel(proposed.section),
    },
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

// What a request is judged against, beside the numbers. The front of the pack
// is what it looks like; the label is what the panel below can be checked
// against, and it is never served to anybody but an administrator and whoever
// took it. A reviewer may put their own picture in place of either, which is
// the same job as correcting a number somebody misread.
function Evidence({
  item,
  name,
  busy,
  onLook,
  onReplace,
  onRemove,
}: {
  item: QueueItem
  name: string
  busy: boolean
  onLook: (url: string) => void
  // Given on the kinds a reviewer may change. A picture offered on its own is
  // kept or turned down as it is.
  onReplace?: (purpose: PhotoPurpose, file: File) => void
  onRemove?: (purpose: PhotoPurpose) => void
}) {
  const field = useId()
  const shots: { url: string | null; alt: string; label: string; purpose: PhotoPurpose }[] = [
    {
      url: item.photo_url,
      alt: `The front of ${name}`,
      label: 'Front',
      purpose: 'front',
    },
    {
      url: item.label_photo_url,
      alt: `The nutrition label for ${name}`,
      label: 'Label',
      purpose: 'label',
    },
  ]
  const editable = onReplace !== undefined && onRemove !== undefined
  const shown = editable ? shots : shots.filter((shot) => shot.url !== null)
  if (shown.length === 0) return null

  const take = (purpose: PhotoPurpose) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (file) onReplace?.(purpose, file)
  }

  return (
    <div className="mt-3 flex gap-3">
      {shown.map((shot) => (
        <div key={shot.purpose} className="min-w-0">
          {shot.url === null ? (
            <div className="t-phototile h-24 w-24 rounded-lg text-xs">None</div>
          ) : (
            <button
              type="button"
              className="block text-left"
              aria-label={`Look at the ${shot.label.toLowerCase()}`}
              onClick={() => onLook(shot.url as string)}
            >
              <img
                src={shot.url}
                alt={shot.alt}
                className="h-24 w-24 rounded-lg border border-line object-cover"
              />
            </button>
          )}
          <span className="t-micro mt-1 block">{shot.label}</span>
          {editable && (
            <div className="flex items-center gap-3">
              <label
                className="t-tap44 cursor-pointer text-xs font-semibold text-accent"
                htmlFor={`${field}-${shot.purpose}`}
              >
                Replace
              </label>
              <input
                id={`${field}-${shot.purpose}`}
                className="sr-only"
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={take(shot.purpose)}
              />
              {shot.url !== null && (
                <button
                  type="button"
                  className="t-tap44 text-xs font-semibold text-muted"
                  disabled={busy}
                  onClick={() => onRemove?.(shot.purpose)}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// The panel as the person who filled it in read it: per the serving the label
// prints, which is what the photograph beside it shows. Position 0 is that
// serving. A proposal without one is read per the 100 it is stored in, named
// as the serving it stands in for.
function Panel({ food, ingredients }: { food: Proposed; ingredients?: string | null }) {
  const serving = food.servings[0] ?? null
  const per =
    serving === null
      ? `Per serving (100 ${food.base_unit})`
      : `Per ${serving.name} (${serving.base_amount} ${food.base_unit})`
  const each = (value: number | null): number | null =>
    serving === null ? value : scale(value, serving.base_amount)

  return (
    <>
      <p className="t-micro mt-3 mb-1">{per}</p>
      <div className="grid grid-cols-2 gap-x-4">
        {SHARED_FACTS.map((fact) => (
          <div key={fact.key} className="t-row min-h-8 text-sm">
            <span className="flex-1 text-muted">{fact.label}</span>
            <span className="t-nums">
              {nutrientText(fact.key, each(food[fact.key]))} {fact.unit}
            </span>
          </div>
        ))}
      </div>

      <p className="t-micro mt-3 mb-1">Serving name / size</p>
      {food.servings.map((serving, index) => (
        <div key={index} className="t-row min-h-8 text-sm">
          <span className="flex-1 text-muted">{serving.name}</span>
          <span className="t-nums">
            {serving.base_amount} {food.base_unit}
          </span>
        </div>
      ))}

      {/* What the submitter says is in it, read against the label photo.
          Folded, like the rest of the label: it is long and it is checked
          second. */}
      {ingredients && (
        <Fold label="Ingredients">
          <p className="text-xs text-muted whitespace-pre-line">{ingredients}</p>
        </Fold>
      )}
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
  me,
  refresh,
  onBack,
  onDecided,
}: {
  // Read for one thing: an administrator decides their own, a reviewer does not.
  me: Me
  // The app-wide change tick. Somebody submitting a food while this is open
  // puts it in the queue, and the queue is what this screen is.
  refresh: number
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
  // What a member is told when their report is resolved, per report. Optional:
  // a food that has been put right is usually its own answer.
  const [answer, setAnswer] = useState<Record<number, string>>({})
  const [showAll, setShowAll] = useState<Record<number, boolean>>({})
  // The proposal being corrected before it is decided, loaded whole so the
  // form has its servings as well as its panel, and the request it belongs to.
  // Null for a report, which is a food that is already shared: there is no
  // request holding pictures for it.
  const [adjusting, setAdjusting] = useState<{ food: Food; item: QueueItem | null } | null>(
    null
  )
  // The request an approval is being confirmed for. His decision: yes is the
  // one answer here that cannot be taken back, so it is asked twice.
  const [approving, setApproving] = useState<QueueItem | null>(null)
  // Which row is open. The queue is a list of line items; one card at a time
  // is read out of it.
  const [selected, setSelected] = useState<number | null>(null)

  const items = queue ?? []
  // The open one, or nothing: a row withdrawn or decided while it was open is
  // no longer in the queue, and the list is where that leaves the screen.
  const chosen = selected === null ? null : (items.find((row) => row.id === selected) ?? null)
  const chosenAbout = chosen === null ? null : chosen.kind === 'new' ? chosen.food : chosen.target

  // The form names itself while a proposal is being corrected.
  useTopBar(
    adjusting !== null
      ? null
      : chosen === null
        ? { title: 'Review queue', back: { label: 'More', onBack } }
        : {
            title: chosenAbout?.name ?? 'A deleted food',
            back: { label: 'Review queue', onBack: () => setSelected(null) },
          }
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
  }, [refresh])

  // What approving one of these sends, in one place: the button asks the
  // question and the dialog answers it, and they must agree on the body.
  const approveBody = (item: QueueItem): Record<string, unknown> =>
    item.kind === 'new'
      ? { keep_photo: keepPhoto[item.id] ?? true }
      : item.kind === 'report'
        ? { note: answer[item.id] ?? '' }
        : {}

  const decide = async (id: number, path: string, body: unknown) => {
    setBusy(true)
    setError('')
    try {
      await api(`/admin/queue/${id}/${path}`, { method: 'POST', body })
      setRejecting(null)
      setReason('')
      setApproving(null)
      setSelected(null)
      await load()
      onDecided()
    } catch (failure) {
      // Somebody else decided this one first. The queue is read again, so the
      // row that is no longer waiting leaves the screen with the message.
      const decided =
        failure instanceof ApiError &&
        failure.status === 409 &&
        failure.detail.startsWith(DECIDED_ALREADY)
      const clash = path === 'approve' && failure instanceof ApiError && failure.status === 409
      setError(decided || !clash ? errorText(failure) : DUPLICATE)
      if (decided) await load()
    }
    setBusy(false)
  }

  // What a reviewer's picture does to a request, from the strip and from the
  // editor alike. An id puts one in place; nothing takes the standing one off.
  const setPhoto = (id: number, purpose: PhotoPurpose, photoId: number | null) =>
    photoId === null
      ? api(`/admin/queue/${id}/photo?purpose=${purpose}`, { method: 'DELETE' })
      : api(`/admin/queue/${id}/photo`, { method: 'POST', body: { photo_id: photoId, purpose } })

  const replacePhoto = async (id: number, purpose: PhotoPurpose, file: File) => {
    if (file.size > MAX_PHOTO_BYTES) {
      setError(PHOTO_TOO_LARGE)
      return
    }
    setBusy(true)
    setError('')
    try {
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file, purpose)
      await setPhoto(id, purpose, photo_id)
      await load()
      onDecided()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const removePhoto = async (id: number, purpose: PhotoPurpose) => {
    setBusy(true)
    setError('')
    try {
      await setPhoto(id, purpose, null)
      await load()
      onDecided()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  // A proposal opened in the form. The request comes with it on the kinds whose
  // pictures a reviewer may change, so the editor can show and replace both.
  // Called again by the editor's Reload, when somebody else saved first.
  const adjust = async (item: QueueItem | null, foodId: number, reviewing: boolean) => {
    setBusy(true)
    setError('')
    try {
      const food = await api<Food>(`/foods/${foodId}`)
      setAdjusting({ food, item: reviewing ? item : null })
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  if (adjusting !== null) {
    const request = adjusting.item
    return (
      <FoodForm
        food={adjusting.food}
        // A report is about a food that is already shared, so what this opens
        // is the row itself rather than a proposal waiting on a decision.
        title={
          adjusting.food.status === 'approved' ? 'Edit this food' : 'Edit before approving'
        }
        backLabel="Review queue"
        complete
        review={
          request === null
            ? {
                // A report opens the shared row itself, so both tiles write to
                // the food rather than to a request waiting on a decision.
                frontPhotoUrl: adjusting.food.photo_url,
                labelPhotoUrl: adjusting.food.label_photo_url ?? null,
                onPhoto: (purpose, photoId) =>
                  foodPhoto(adjusting.food.id, purpose, photoId),
              }
            : {
                frontPhotoUrl: request.photo_url,
                labelPhotoUrl: request.label_photo_url,
                onPhoto: (purpose, photoId) => setPhoto(request.id, purpose, photoId),
              }
        }
        onSaved={() => {
          setAdjusting(null)
          void load()
          onDecided()
        }}
        onCancel={() => setAdjusting(null)}
        onReload={() =>
          void adjust(adjusting.item, adjusting.food.id, adjusting.item !== null)
        }
      />
    )
  }

  // What the confirmation names. A request about a shared food names that one;
  // a new food names itself.
  const approvingName =
    approving === null
      ? ''
      : ((approving.kind === 'new' ? approving.food?.name : approving.target?.name) ??
        'this food')

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      {queue !== null && queue.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing waiting.</p>
        </div>
      )}

      {chosen === null && items.length > 0 && (
        <div className="t-card mb-3">
          {items.map((item) => {
            const about = item.kind === 'new' ? item.food : item.target
            // Their own row is greyed and does not open. An administrator has
            // no such row: they decide everything, their own included.
            const locked = item.mine && !me.is_admin
            const who = locked ? 'by You' : `From ${item.submitted_by ?? 'a closed account'}`
            return (
              <button
                key={item.id}
                type="button"
                className={`t-row w-full text-left ${locked ? 'opacity-50' : ''}`}
                aria-disabled={locked || undefined}
                onClick={locked ? undefined : () => setSelected(item.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {about?.name ?? 'A deleted food'}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {who} &middot; {about?.brand || 'No brand'}
                  </span>
                </span>
                <span className="t-chip shrink-0">{KIND_LABEL[item.kind] ?? item.kind}</span>
                {!locked && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
                )}
              </button>
            )
          })}
        </div>
      )}

      {(chosen === null ? [] : [chosen]).map((item) => {
        const about = item.kind === 'new' ? item.food : item.target
        // What the food is, in the words on the package. A proposal carries its
        // own; anything about a shared food carries the shared one's.
        const description =
          item.kind === 'new' ? item.food?.description : item.current?.description
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
                {description && <p className="truncate text-sm text-muted">{description}</p>}
                <p className="truncate text-sm text-muted">{about?.brand || 'No brand'}</p>
                {item.kind === 'new' && item.food && (
                  <p className="truncate text-sm text-muted">{sectionLabel(item.food.section)}</p>
                )}
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

            {proposal && (item.kind === 'new' || item.current) && (
              <>
                <Evidence
                  item={item}
                  name={proposal.name}
                  busy={busy}
                  onLook={setLooking}
                  onReplace={(purpose, file) => void replacePhoto(item.id, purpose, file)}
                  onRemove={(purpose) => void removePhoto(item.id, purpose)}
                />
                {item.kind === 'new' ? (
                  <Panel food={proposal} ingredients={proposal.ingredients_text} />
                ) : (
                  <Comparison
                    now={item.current as Proposed}
                    proposed={proposal}
                    showAll={showAll[item.id] ?? false}
                    onShowAll={() => setShowAll({ ...showAll, [item.id]: true })}
                  />
                )}
                <button
                  type="button"
                  className="t-btn mt-3 w-full"
                  disabled={busy}
                  onClick={() => adjust(item, proposal.id, true)}
                >
                  Edit before approving
                </button>
              </>
            )}

            {item.kind === 'report' && item.current && (
              <>
                <Panel food={item.current} ingredients={item.current.ingredients_text} />
                <button
                  type="button"
                  className="t-btn mt-3 w-full"
                  disabled={busy}
                  onClick={() => adjust(item, (item.current as Proposed).id, false)}
                >
                  Fix it
                </button>
                <label className="t-label mt-3 block" htmlFor={`answer-${item.id}`}>
                  What to tell them (optional)
                </label>
                <input
                  id={`answer-${item.id}`}
                  className="t-input"
                  maxLength={500}
                  value={answer[item.id] ?? ''}
                  onChange={(event) =>
                    setAnswer({ ...answer, [item.id]: event.target.value })
                  }
                />
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
                      aria-label="Look at the picture being submitted"
                      onClick={() => setLooking(item.photo_url)}
                    >
                      <img
                        src={item.photo_url}
                        alt="The picture being submitted"
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
                <span className="flex-1">Keep front photo</span>
              </label>
            )}

            {rejecting === item.id ? (
              <div className="mt-3">
                <label className="t-label" htmlFor={`reject-${item.id}`}>
                  {item.kind === 'report'
                    ? 'Why it stays as it is, in a sentence'
                    : 'Why not, in a sentence'}
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
                    disabled={busy || reason.trim() === ''}
                    onClick={() => decide(item.id, 'reject', { note: reason })}
                  >
                    {item.kind === 'report' ? 'Dismiss' : 'Reject'}
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
                  onClick={() => {
                    // Resolving a report changes nothing anybody else sees, so
                    // it stays one tap. Approving is asked about first.
                    if (item.kind === 'report') {
                      void decide(item.id, 'approve', approveBody(item))
                      return
                    }
                    setApproving(item)
                  }}
                >
                  {item.kind === 'report' ? 'Resolve' : 'Approve'}
                </button>
                <button
                  type="button"
                  className="t-btn"
                  onClick={() => {
                    setRejecting(item.id)
                    setReason('')
                  }}
                >
                  {item.kind === 'report' ? 'Dismiss' : 'Reject'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      <Sheet
        center
        open={approving !== null}
        label={`Approve ${approvingName}?`}
        onClose={() => setApproving(null)}
      >
        <p className="text-base font-semibold tracking-tight">Approve {approvingName}?</p>
        <p className="mt-2 text-sm text-muted">
          This goes into the Tare database for everybody.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            disabled={busy}
            onClick={() => {
              if (approving === null) return
              void decide(approving.id, 'approve', approveBody(approving))
            }}
          >
            Approve
          </button>
          <button type="button" className="t-btn" onClick={() => setApproving(null)}>
            Cancel
          </button>
        </div>
      </Sheet>

      {looking && <Lightbox src={looking} alt="The label" onClose={() => setLooking(null)} />}
    </>
  )
}
