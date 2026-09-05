import {
  BookmarkCheck,
  BookmarkPlus,
  CalendarSync,
  Camera,
  Pencil,
  Pin,
  PinOff,
  ThumbsUp,
  Trash2,
  UserRound,
} from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'

import { api, errorText, upload, type AutoLog, type Food, type Me } from '../api'
import { Verified } from '../components/FoodRows'
import { NutritionLabel } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { Lightbox } from '../components/Lightbox'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import {
  KIND_LABEL,
  MAX_PHOTO_BYTES,
  PHOTO_TOO_LARGE,
  SENT_FOR_REVIEW,
  changeLine,
  sectionLabel,
  statusLabel,
} from '../lib/community'
import { dayLabel, dayOf, slotByTime, today } from '../lib/day'

// How long the line saying something was sent stays up.
const NOTICE = 4000

export function FoodDetail({
  id,
  me,
  backLabel,
  onBack,
  onEdit,
  onDelete,
  onDeleteShared,
  onSubmitted,
  onSeen,
  onChanged,
}: {
  id: number
  me: Me
  // What the screen behind this one is called, because a food is opened from
  // the tab's own list and from the shared database alike.
  backLabel: string
  onBack: () => void
  // Why the form is being opened. A notice says which box sent somebody
  // there; submitDefault is Resubmit, which is the same form with the switch
  // already on.
  onEdit: (food: Food, opened?: { notice?: string; submitDefault?: boolean }) => void
  // A member deleting a food of their own. Asked on this page like the shared
  // one, and gone for good once they say so.
  onDelete: (food: Food) => Promise<void>
  // An administrator taking a food out of the shared database. Confirmed on
  // this page and done at once: there is no undo for something everybody had.
  onDeleteShared: (food: Food) => Promise<void>
  onSubmitted: () => void
  // The answers on this page have been read, so the badge that counted them is
  // worth asking again.
  onSeen: () => void
  // Something about this food changed that a screen behind this one shows too.
  // Quick add is the one that does: pinning puts a food on it and unpinning
  // takes it off, and the list was read once when that screen opened.
  onChanged?: () => void
}) {
  const [food, setFood] = useState<Food | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  // Whether this food already logs itself, and the sheet that sets it up.
  const [standing, setStanding] = useState<AutoLog | null>(null)
  const [autoOpen, setAutoOpen] = useState(false)
  const [sending, setSending] = useState(false)
  // The front picture, shown big.
  const [viewing, setViewing] = useState<string | null>(null)
  // Saying what is wrong with a food everybody eats out of, over this screen
  // rather than in place of it.
  const [reporting, setReporting] = useState(false)
  const [issue, setIssue] = useState('')
  const [notice, setNotice] = useState('')

  useTopBar({ title: food?.name ?? 'Food', back: { label: backLabel, onBack } })

  useEffect(() => {
    let alive = true
    api<Food>(`/foods/${id}`)
      .then((loaded) => alive && setFood(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [id])

  // The instruction is the member's rather than the food's, so it is read
  // here rather than carried on the food.
  const loadStanding = () =>
    api<AutoLog[]>('/diary/auto-logs')
      .then((rows) => setStanding(rows.find((row) => row.food_id === id) ?? null))
      .catch(() => {})

  useEffect(() => {
    let alive = true
    api<AutoLog[]>('/diary/auto-logs')
      .then((rows) => alive && setStanding(rows.find((row) => row.food_id === id) ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), NOTICE)
    return () => window.clearTimeout(timer)
  }, [notice])

  // The card on this page lists the answers, so reading the page is reading
  // them. Once, and the badge is asked again after.
  const unread = (food?.submissions ?? []).some(
    (row) => row.status !== 'pending' && row.seen_at === null
  )
  useEffect(() => {
    if (!unread) return
    api('/submissions/seen', { method: 'POST' })
      .then(() => {
        onSeen()
        return api<Food>(`/foods/${id}`)
      })
      .then(setFood)
      .catch(() => {})
  }, [unread, id, onSeen])

  const togglePin = async (current: Food) => {
    // Shown as done before it is: pinning is idempotent both ways, so a request
    // that fails leaves nothing to reconcile beyond the next read.
    setFood({ ...current, pinned: !current.pinned })
    try {
      await api(`/foods/${current.id}/pin`, { method: current.pinned ? 'DELETE' : 'POST' })
      onChanged?.()
    } catch (failure) {
      setFood(current)
      setError(errorText(failure))
    }
  }

  // Put a shared food on this account's list of foods, or take it off again.
  // Shown as done before it is, like the pin: both ways are idempotent, so a
  // request that fails leaves nothing to reconcile beyond the next read.
  const toggleKeep = async (current: Food) => {
    setFood({ ...current, kept: !current.kept })
    try {
      await api(`/foods/${current.id}/keep`, { method: current.kept ? 'DELETE' : 'POST' })
      onChanged?.()
    } catch (failure) {
      setFood(current)
      setError(errorText(failure))
    }
  }

  // Take back a request that has not been decided. The food is left exactly
  // as it was, privately, which is what the server does with it.
  const withdraw = async (current: Food, submissionId: number) => {
    setSending(true)
    setError('')
    try {
      await api(`/submissions/${submissionId}`, { method: 'DELETE' })
      setFood(await api<Food>(`/foods/${current.id}`))
      onSubmitted()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  // Put a picture on one of your own foods. It is not submitted to anybody: it
  // stays with the food, and goes with it if the food is ever shared.
  const attachFront = async (current: Food, photoId: number) => {
    setSending(true)
    setError('')
    try {
      await api(`/foods/${current.id}/photo`, { method: 'POST', body: { photo_id: photoId } })
      setFood(await api<Food>(`/foods/${current.id}`))
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  // One control, two meanings, and which one it is follows who owns the food.
  // Your own: the picture goes straight on it and rides along if you ever
  // submit it. Everybody's: a picture of a shared food is a proposal like any
  // other.
  const takePhoto = async (event: ChangeEvent<HTMLInputElement>, current: Food) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_PHOTO_BYTES) {
      setError(PHOTO_TOO_LARGE)
      return
    }
    setSending(true)
    try {
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file, 'front')
      if (current.mine) {
        await attachFront(current, photo_id)
        return
      }
      await api('/submissions/photo', {
        method: 'POST',
        body: { target_food_id: current.id, photo_id },
      })
      setNotice(SENT_FOR_REVIEW)
      onSubmitted()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  // Say what is wrong with a shared food. Nothing about the food moves: the
  // request is the food put back in front of whoever reviews it.
  const send = async (current: Food) => {
    setSending(true)
    setError('')
    try {
      await api('/submissions/report', {
        method: 'POST',
        body: { target_food_id: current.id, note: issue },
      })
      setReporting(false)
      setIssue('')
      setFood(await api<Food>(`/foods/${current.id}`))
      setNotice(SENT_FOR_REVIEW)
      onSubmitted()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  const shared = food !== null && food.status === 'approved'
  // The red popup, and the request it fires.
  const [erasing, setErasing] = useState(false)
  const [erasingBusy, setErasingBusy] = useState(false)
  const [erasingError, setErasingError] = useState('')
  // The request that made a shared food shared, when it was this account's.
  // The page says so in one line; the full history lives on the Food tab.
  const offered = shared
    ? food.submissions.find((row) => row.kind === 'new' && row.status === 'approved')
    : undefined
  // A shared food already reported by this account. One at a time, so the
  // button says it has been done rather than offering to do it again.
  const reported = food?.submissions.find(
    (row) => row.kind === 'report' && row.status === 'pending'
  )
  // The newest request about this food, which is what the card's one button
  // answers: a decision that has not been made yet can be taken back, and
  // anything else is offered again.
  const latest = food?.submissions[0]
  const waiting = latest !== undefined && latest.status === 'pending' ? latest : undefined

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {food && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="min-w-0 text-xl font-semibold tracking-tight">{food.name}</p>
                {shared && <Verified className="h-5 w-5" />}
              </div>
              <div className="mb-3 flex items-center gap-2">
                <p className="truncate text-sm text-muted">{food.brand || 'No brand'}</p>
                {/* Which aisle it is browsed under, on the foods that are
                    browsed. A private food is nobody else's to find. */}
                {shared && (
                  <span className="t-chip shrink-0">{sectionLabel(food.section)}</span>
                )}
              </div>
            </div>
            {food.status === 'pending' && <span className="t-chip shrink-0">pending</span>}
          </div>

          <div className="mb-3 flex items-center gap-3">
            {food.photo_url ? (
              // A picture on file opens big. Swapping it is the edit form's job.
              <button
                type="button"
                className="block shrink-0"
                aria-label="See the front picture"
                onClick={() => setViewing(food.photo_url)}
              >
                <img
                  src={food.photo_url}
                  alt={`The front of ${food.name}`}
                  className="h-24 w-24 rounded-xl border border-line object-cover"
                />
              </button>
            ) : (
              <>
                <label className="t-phototile h-24 w-24 cursor-pointer rounded-xl" htmlFor="detail-photo">
                  <Camera className="h-6 w-6" strokeWidth={1.75} />
                  <span className="sr-only">
                    {food.mine ? 'Add a photo of the front' : 'Submit a photo of the front'}
                  </span>
                </label>
                <input
                  id="detail-photo"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={sending}
                  onChange={(event) => takePhoto(event, food)}
                />
              </>
            )}
            {food.description && (
              <p className="min-w-0 flex-1 text-sm">{food.description}</p>
            )}
          </div>
          {offered && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-muted">
              <ThumbsUp className="h-4 w-4 text-accent" strokeWidth={2.25} aria-hidden="true" />
              You created this item
            </p>
          )}
          {/* Who the shared database has it from, for everybody but them. The
              line above is the same fact said to the person who offered it. */}
          {!offered && food.submitted_by !== null && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-muted">
              <UserRound className="h-4 w-4 text-muted" strokeWidth={2.25} aria-hidden="true" />
              Submitted by {food.submitted_by}
            </p>
          )}

          <NutritionLabel food={food} />

          {/* One row across the whole card rather than the capped one every
              other screen uses: these belong to the panel above them. Two to a
              line on a phone, because four labels do not fit across 390. */}
          <div className="mb-3 flex flex-wrap gap-3">
            <button
              className="t-btn t-btn-primary w-full min-[640px]:w-auto min-[640px]:flex-1"
              type="button"
              onClick={() => setLogging(true)}
            >
              Log
            </button>
            <button
              className="t-btn flex-1 basis-[calc(50%-0.375rem)] min-[640px]:flex-none min-[640px]:basis-auto"
              type="button"
              aria-pressed={food.pinned}
              onClick={() => togglePin(food)}
            >
              {food.pinned ? (
                <PinOff className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Pin className="h-4 w-4" strokeWidth={2} />
              )}
              {food.pinned ? 'Unpin' : 'Pin to Quick add'}
            </button>
            <button
              className="t-btn flex-1 basis-[calc(50%-0.375rem)] min-[640px]:flex-none min-[640px]:basis-auto"
              type="button"
              aria-pressed={standing !== null}
              onClick={() => setAutoOpen(true)}
            >
              <CalendarSync className="h-4 w-4" strokeWidth={2} />
              {standing === null ? 'Auto-log' : 'Auto-logging'}
            </button>
            {/* A food of their own is on their list by nature, so this is only
                offered on the ones out of the shared database. */}
            {shared && (
              <button
                className="t-btn flex-1 basis-[calc(50%-0.375rem)] min-[640px]:flex-none min-[640px]:basis-auto"
                type="button"
                aria-pressed={food.kept}
                onClick={() => void toggleKeep(food)}
              >
                {food.kept ? (
                  <BookmarkCheck className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <BookmarkPlus className="h-4 w-4" strokeWidth={2} />
                )}
                {food.kept ? 'In my foods' : 'Add to my foods'}
              </button>
            )}
            {((food.mine && !shared) || (me.is_admin && shared)) && (
              <button
                className="t-btn flex-1 basis-[calc(50%-0.375rem)] min-[640px]:flex-none min-[640px]:basis-auto"
                type="button"
                onClick={() => onEdit(food)}
              >
                <Pencil className="h-4 w-4" strokeWidth={2} />
                Edit
              </button>
            )}
          </div>

          {shared && !me.is_admin && (
            <div className="t-card mb-3">
              <p className="t-micro mb-2">Help improve Tare</p>
              <div className="t-actions">
                <button
                  className="t-btn flex-1"
                  type="button"
                  disabled={sending || reported !== undefined}
                  onClick={() => {
                    setIssue('')
                    setReporting(true)
                  }}
                >
                  {reported === undefined ? 'Report an issue' : 'Reported'}
                </button>
              </div>
            </div>
          )}

          {food.mine && (food.status === 'custom' || food.status === 'pending') && (
            <div className="t-card mb-3">
              <p className="t-micro mb-1">Submissions</p>
              {food.submissions.length === 0 ? (
                <p className="mb-3 text-sm text-muted">Not submitted yet.</p>
              ) : (
                food.submissions.map((row) => (
                  <div key={row.id}>
                    <div className="t-row min-h-9 text-sm">
                      <span className="min-w-0 flex-1">
                        {KIND_LABEL[row.kind] ?? row.kind} ·{' '}
                        {dayLabel(dayOf(me.timezone, row.created_at), today(me.timezone))}
                      </span>
                      <span className="t-chip shrink-0">
                        {statusLabel(row.status, row.edited, row.kind)}
                      </span>
                    </div>
                    {row.changes.length > 0 && (
                      <p className="mb-2 text-xs text-muted">{changeLine(row.changes)}</p>
                    )}
                    {row.status === 'rejected' && row.decision_note && (
                      <p className="mb-2 text-xs text-muted">Reason: {row.decision_note}</p>
                    )}
                  </div>
                ))
              )}
              {waiting === undefined ? (
                <button
                  className="t-btn t-btn-primary w-full"
                  type="button"
                  disabled={sending}
                  onClick={() => onEdit(food, { submitDefault: true })}
                >
                  {latest === undefined || latest.status !== 'rejected'
                    ? 'Submit to Tare database'
                    : 'Resubmit'}
                </button>
              ) : (
                <button
                  className="t-btn w-full"
                  type="button"
                  disabled={sending}
                  onClick={() => void withdraw(food, waiting.id)}
                >
                  Withdraw
                </button>
              )}
            </div>
          )}

          {food.mine && food.status === 'pending' && (
            <p className="mb-3 text-sm text-muted">
              This is waiting for approval. It is still yours to log in the meantime.
            </p>
          )}

          {/* Last on the page and quiet with it: deleting a food is a thing
              somebody comes here to do, not a thing they meet on the way. */}
          {food.mine && food.status === 'custom' && (
            <button
              className="mb-3 flex min-h-11 w-full items-center text-sm text-danger"
              type="button"
              onClick={() => {
                setErasingError('')
                setErasing(true)
              }}
            >
              Delete this food
            </button>
          )}
          {me.is_admin && shared && (
            <button
              className="t-btn t-btn-danger mb-3 w-full"
              type="button"
              onClick={() => {
                setErasingError('')
                setErasing(true)
              }}
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              Delete from the Tare database
            </button>
          )}

          {notice && (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
              <div className="mx-auto w-full max-w-md rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
                {notice}
              </div>
            </div>
          )}

          <Sheet
            open={reporting}
            label="Report an issue"
            onClose={() => setReporting(false)}
          >
            <p className="mb-1 text-base font-semibold tracking-tight">Report an issue</p>
            <p className="mb-3 text-sm text-muted">{food.name}</p>
            <label className="t-micro mb-2 block" htmlFor="report-issue">
              What is wrong with it?
            </label>
            <textarea
              id="report-issue"
              className="t-input"
              rows={4}
              maxLength={500}
              value={issue}
              onChange={(event) => setIssue(event.target.value)}
            />
            <p className="mt-2 text-xs text-muted">
              Your response goes straight to the administrators.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                className="t-btn t-btn-primary flex-1"
                type="button"
                disabled={sending || issue.trim() === ''}
                onClick={() => void send(food)}
              >
                Send
              </button>
              <button className="t-btn" type="button" onClick={() => setReporting(false)}>
                Cancel
              </button>
            </div>
          </Sheet>

          {logging && (
            <PortionSheet
              food={food}
              date={today(me.timezone)}
              slot={slotByTime(me.timezone)}
              units={me.units}
              onClose={() => setLogging(false)}
              onDone={() => setLogging(false)}
            />
          )}
          {autoOpen && (
            <PortionSheet
              food={food}
              date={today(me.timezone)}
              slot={slotByTime(me.timezone)}
              units={me.units}
              onClose={() => setAutoOpen(false)}
              onDone={() => setAutoOpen(false)}
              autoLog={{
                existing: standing,
                onSaved: () => {
                  setAutoOpen(false)
                  void loadStanding()
                  onChanged?.()
                },
                onStopped: () => {
                  setAutoOpen(false)
                  setStanding(null)
                  onChanged?.()
                },
              }}
            />
          )}
          {food !== null && (
            <Sheet
              center
              open={erasing}
              label={`Delete ${food.name}?`}
              onClose={() => setErasing(false)}
            >
              <p className="text-base font-semibold tracking-tight text-danger">
                {shared ? `Delete ${food.name} from the Tare database?` : `Delete ${food.name}?`}
              </p>
              <p className="mt-2 text-sm text-muted">
                {shared
                  ? 'This permanently removes it for every member and cannot be undone. Journal entries that already logged it keep their numbers.'
                  : 'This food is private to you and cannot be recovered.'}
              </p>
              {erasingError && <p className="t-error mt-2">{erasingError}</p>}
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  className="t-btn t-btn-danger flex-1"
                  disabled={erasingBusy}
                  onClick={() => {
                    setErasingBusy(true)
                    ;(shared ? onDeleteShared : onDelete)(food).catch((failure) => {
                      setErasingError(errorText(failure))
                      setErasingBusy(false)
                    })
                  }}
                >
                  {shared ? 'Delete permanently' : 'Delete'}
                </button>
                <button type="button" className="t-btn" onClick={() => setErasing(false)}>
                  Cancel
                </button>
              </div>
            </Sheet>
          )}
          {viewing && (
            <Lightbox
              src={viewing}
              alt={`The front of ${food.name}`}
              onClose={() => setViewing(null)}
            />
          )}
        </>
      )}
    </>
  )
}
