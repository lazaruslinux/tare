import { ChevronLeft, Pin, PinOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Food, type Me } from '../api'
import { NutritionLabel } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { SHARED_FACTS, missingSentence, type Values } from '../lib/community'
import { slotByTime, today } from '../lib/day'

// What a food carries, in the shape the sharing rule reads.
function panelOf(food: Food): Values {
  const values = {} as Values
  for (const fact of SHARED_FACTS) values[fact.key] = food[fact.key]
  return values
}

export function FoodDetail({
  id,
  me,
  onBack,
  onEdit,
  onDelete,
  onSubmitted,
}: {
  id: number
  me: Me
  onBack: () => void
  // The notice is why somebody was sent to the form: a food that was short of
  // what sharing needs opens the form saying which box is empty.
  onEdit: (food: Food, notice?: string) => void
  onDelete: (food: Food) => void
  onSubmitted: () => void
}) {
  const [food, setFood] = useState<Food | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let alive = true
    api<Food>(`/foods/${id}`)
      .then((loaded) => alive && setFood(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [id])

  const togglePin = async (current: Food) => {
    // Shown as done before it is: pinning is idempotent both ways, so a request
    // that fails leaves nothing to reconcile beyond the next read.
    setFood({ ...current, pinned: !current.pinned })
    try {
      await api(`/foods/${current.id}/pin`, { method: current.pinned ? 'DELETE' : 'POST' })
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

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Food
      </button>

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

          <NutritionLabel food={food} />

          <div className="mb-3 flex gap-3">
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
              {food.pinned ? 'Unpin' : 'Pin'}
            </button>
          </div>

          {food.mine && (
            <div className="mb-3 flex gap-3">
              <button className="t-btn flex-1" type="button" onClick={() => onEdit(food)}>
                Edit
              </button>
              <button className="t-btn text-danger" type="button" onClick={() => onDelete(food)}>
                Delete
              </button>
            </div>
          )}

          {food.mine && food.status === 'custom' && (
            <div className="t-card mb-3">
              <button
                className="t-btn w-full"
                type="button"
                disabled={sending}
                onClick={() => offer(food)}
              >
                Submit to community
              </button>
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
