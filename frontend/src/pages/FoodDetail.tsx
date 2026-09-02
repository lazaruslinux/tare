import { ImagePlus, Pencil, Pin, PinOff } from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'

import { api, errorText, upload, type Food, type Me } from '../api'
import { FoodForm } from '../components/FoodForm'
import { NutritionLabel } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
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

  const offer = async (current: Food) => {
    // Checked here first, so somebody short of half a label lands in the form
    // with the reason rather than on a refusal they have to go back from.
    const missing = missingSentence(panelOf(current), current.servings.length)
    if (missing !== null) {
      onEdit(current, missing)
      return
    }
    setSending(true)
    setError('')
    try {
      const answer = await api<{ food: Food }>(`/foods/${current.id}/submit`, {
        method: 'POST',
        body: {},
      })
      setFood(answer.food)
      onSubmitted()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  const offerPhoto = async (event: ChangeEvent<HTMLInputElement>, current: Food) => {
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
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file)
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

          {food.photo_url && (
            <img
              src={food.photo_url}
              alt={`The label for ${food.name}`}
              className="mb-3 max-h-72 w-full rounded-xl border border-line object-cover"
            />
          )}

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
                <label className="t-btn flex-1" htmlFor="detail-photo">
                  <ImagePlus className="h-4 w-4" strokeWidth={2} />
                  Submit photo
                </label>
                <input
                  id="detail-photo"
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={sending}
                  onChange={(event) => offerPhoto(event, food)}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                Both go to an administrator. Nothing changes here until one is approved.
              </p>
            </div>
          )}

          {food.mine && food.status === 'custom' && (
            <div className="t-card mb-3">
              <div className="t-actions mb-2">
              <button
                  className="t-btn flex-1"
                  type="button"
                  disabled={sending}
                  onClick={() => offer(food)}
                >
                  Submit to community
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">
                It stays yours until an administrator approves it. Then everyone has it.
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
