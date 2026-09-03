import { Camera, Pencil, Pin, PinOff } from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'

import { api, errorText, upload, type Food, type Me } from '../api'
import { FoodForm } from '../components/FoodForm'
import { NutritionLabel } from '../components/NutritionLabel'
import { PhotoSlots } from '../components/PhotoSlots'
import { PortionSheet } from '../components/PortionSheet'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import {
  MAX_PHOTO_BYTES,
  PHOTO_TOO_LARGE,
  SENT_FOR_REVIEW,
  SHARED_FACTS,
  missingSentence,
  type Values,
} from '../lib/community'
import { slotByTime, today } from '../lib/day'

// How long the line saying something was sent stays up.
const NOTICE = 4000

// What a food carries, in the shape the sharing rule reads.
function panelOf(food: Food): Values {
  const values = {} as Values
  for (const fact of SHARED_FACTS) values[fact.key] = food[fact.key]
  return values
}

export function FoodDetail({
  id,
  me,
  backLabel,
  onBack,
  onEdit,
  onDelete,
  onSubmitted,
  onChanged,
}: {
  id: number
  me: Me
  // What the screen behind this one is called, because a food is opened from
  // the tab's own list and from the shared database alike.
  backLabel: string
  onBack: () => void
  // The notice is why somebody was sent to the form: a food that was short of
  // what sharing needs opens the form saying which box is empty.
  onEdit: (food: Food, notice?: string) => void
  onDelete: (food: Food) => void
  onSubmitted: () => void
  // Something about this food changed that a screen behind this one shows too.
  // Repeat is the one that does: pinning puts a food on it and unpinning takes
  // it off, and the list was read once when that screen opened.
  onChanged?: () => void
}) {
  const [food, setFood] = useState<Food | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  const [sending, setSending] = useState(false)
  // The correction form, open over this screen rather than in place of it, so
  // going back lands on the food it is about.
  const [suggesting, setSuggesting] = useState(false)
  // The photos step of submitting a food, which is the one thing the page
  // cannot already answer: a packaged food needs its panel photographed, and
  // that picture belongs to the request rather than to the food.
  const [offering, setOffering] = useState(false)
  const [labelPhotoId, setLabelPhotoId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')

  // The correction form names itself while it is open.
  useTopBar(
    suggesting ? null : { title: food?.name ?? 'Food', back: { label: backLabel, onBack } }
  )

  useEffect(() => {
    let alive = true
    api<Food>(`/foods/${id}`)
      .then((loaded) => alive && setFood(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), NOTICE)
    return () => window.clearTimeout(timer)
  }, [notice])

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

  const offer = (current: Food) => {
    // Checked here first, so somebody short of half a label lands in the form
    // with the reason rather than on a refusal they have to go back from.
    const missing = missingSentence(panelOf(current), current.servings.length)
    if (missing !== null) {
      onEdit(current, missing)
      return
    }
    setError('')
    setOffering(true)
  }

  const send = async (current: Food) => {
    setSending(true)
    setError('')
    try {
      const answer = await api<{ food: Food }>(`/foods/${current.id}/submit`, {
        method: 'POST',
        body: { label_photo_id: labelPhotoId },
      })
      setOffering(false)
      setFood(answer.food)
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

  if (suggesting && food !== null) {
    return (
      <FoodForm
        food={food}
        title="Suggest edit"
        backLabel={food.name}
        sharing
        onSubmit={async (payload) => {
          const { note, ...proposed } = payload
          const answer = await api<{ food: Food }>('/submissions/edit', {
            method: 'POST',
            body: { target_food_id: food.id, proposed, note },
          })
          return answer.food
        }}
        onSaved={() => {
          setSuggesting(false)
          setNotice(SENT_FOR_REVIEW)
          onSubmitted()
        }}
        onCancel={() => setSuggesting(false)}
      />
    )
  }

  const shared = food !== null && food.status === 'approved'

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {food && (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">{food.name}</p>
              <p className="mb-3 text-sm text-muted">{food.brand || 'No brand'}</p>
            </div>
            {food.status === 'pending' && <span className="t-chip shrink-0">pending</span>}
          </div>

          <div className="mb-3 flex items-center gap-3">
            <label
              className={
                food.photo_url
                  ? 'block cursor-pointer'
                  : 't-phototile h-24 w-24 cursor-pointer rounded-xl'
              }
              htmlFor="detail-photo"
            >
              {food.photo_url ? (
                <img
                  src={food.photo_url}
                  alt={`The front of ${food.name}`}
                  className="h-24 w-24 rounded-xl border border-line object-cover"
                />
              ) : (
                <Camera className="h-6 w-6" strokeWidth={1.75} />
              )}
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
            <p className="min-w-0 flex-1 text-xs text-muted">
              {food.mine
                ? 'A picture of the front of the pack. It goes with this food if you ever submit it.'
                : 'Submit a picture of the front. An administrator decides whether it is published.'}
            </p>
          </div>

          <NutritionLabel food={food} />

          <div className="t-actions mb-3">
            <button
              className="t-btn t-btn-primary flex-1"
              type="button"
              onClick={() => setLogging(true)}
            >
              Log
            </button>
            <button
              className="t-btn"
              type="button"
              aria-pressed={food.pinned}
              onClick={() => togglePin(food)}
            >
              {food.pinned ? (
                <PinOff className="h-4 w-4" strokeWidth={2} />
              ) : (
                <Pin className="h-4 w-4" strokeWidth={2} />
              )}
              {food.pinned ? 'Unpin' : 'Pin to Repeat'}
            </button>
          </div>

          {(food.mine || (me.is_admin && shared)) && (
            <div className="t-actions mb-3">
              <button className="t-btn flex-1" type="button" onClick={() => onEdit(food)}>
                <Pencil className="h-4 w-4" strokeWidth={2} />
                Edit
              </button>
              {food.mine && (
                <button
                  className="t-btn text-danger"
                  type="button"
                  onClick={() => onDelete(food)}
                >
                  Delete
                </button>
              )}
            </div>
          )}

          {shared && (
            <div className="t-card mb-3">
              <p className="t-micro mb-2">Something wrong with it</p>
              <div className="t-actions">
                <button
                  className="t-btn flex-1"
                  type="button"
                  disabled={sending}
                  onClick={() => setSuggesting(true)}
                >
                  Suggest edit
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                It goes to an administrator. Nothing changes here until it is approved.
              </p>
            </div>
          )}

          {food.mine && food.status === 'custom' && food.community !== 'rejected' && (
            <div className="t-card mb-3">
              <div className="t-actions mb-2">
                <button
                  className="t-btn flex-1"
                  type="button"
                  disabled={sending}
                  onClick={() => offer(food)}
                >
                  Submit to Tare database
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                It stays yours until an administrator approves it. Then everyone has it.
              </p>
            </div>
          )}

          {food.mine && food.status === 'custom' && food.community === 'rejected' && (
            <div className="t-card mb-3">
              <p className="t-micro mb-1">Not approved</p>
              {food.decision_note && <p className="mb-3 text-sm">{food.decision_note}</p>}
              <div className="t-actions">
                <button
                  className="t-btn flex-1"
                  type="button"
                  disabled={sending}
                  onClick={() => offer(food)}
                >
                  Submit again
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                It is still yours to log. Fix what the note says and send it back.
              </p>
            </div>
          )}

          {food.mine && food.status === 'pending' && (
            <p className="mb-3 text-sm text-muted">
              This is waiting for approval. It is still yours to log in the meantime.
            </p>
          )}

          {notice && (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
              <div className="mx-auto w-full max-w-md rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
                {notice}
              </div>
            </div>
          )}

          {offering && (
            <Sheet open tall label="Photos" onClose={() => setOffering(false)}>
              <p className="t-micro mb-1">Submitting</p>
              <p className="mb-3 text-base font-semibold tracking-tight">{food.name}</p>

              <PhotoSlots
                front={{ id: null, url: food.photo_url, required: true }}
                label={{ id: labelPhotoId, required: food.barcode !== null }}
                busy={sending}
                onFront={(id) => {
                  if (id !== null) void attachFront(food, id)
                }}
                onLabel={setLabelPhotoId}
                onFailed={setError}
              />

              {error && <p className="t-error mb-3">{error}</p>}

              <div className="t-actions">
                <button
                  className="t-btn t-btn-primary flex-1"
                  type="button"
                  disabled={sending}
                  onClick={() => void send(food)}
                >
                  Send
                </button>
                <button
                  className="t-btn"
                  type="button"
                  onClick={() => setOffering(false)}
                >
                  Cancel
                </button>
              </div>
            </Sheet>
          )}

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
        </>
      )}
    </>
  )
}
