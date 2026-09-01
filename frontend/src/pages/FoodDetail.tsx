import { ChevronLeft, Pin, PinOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Food, type Me } from '../api'
import { NutritionLabel } from '../components/NutritionLabel'
import { PortionSheet } from '../components/PortionSheet'
import { slotByTime, today } from '../lib/day'

export function FoodDetail({
  id,
  me,
  onBack,
  onEdit,
  onDelete,
}: {
  id: number
  me: Me
  onBack: () => void
  onEdit: (food: Food) => void
  onDelete: (food: Food) => void
}) {
  const [food, setFood] = useState<Food | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)

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

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onBack}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Food
      </button>

      {error && <p className="t-error">{error}</p>}
      {food && (
        <>
          <p className="text-xl font-semibold tracking-tight">{food.name}</p>
          <p className="mb-3 text-sm text-muted">{food.brand || 'No brand'}</p>

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
