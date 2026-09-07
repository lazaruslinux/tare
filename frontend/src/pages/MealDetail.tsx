import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Meal, type MealLogged, type Me } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { DishAutoLog, DishPhoto } from '../components/Dish'
import { PartLine } from '../components/FoodRows'
import { LogSheet } from '../components/LogSheet'
import { PanelFacts } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { SLOT_LABEL, slotByTime, today, type Slot } from '../lib/day'
import { gramsText } from '../lib/units'

// How long the line saying what was logged stays up.
const NOTICE = 5000

// One kept meal: what it is worth, what is in it, and the one thing it exists
// for.
export function MealDetail({
  id,
  me,
  backLabel,
  onBack,
  onEdit,
  onDelete,
  onLogged,
}: {
  id: number
  me: Me
  // What the screen behind this one is called: the Food page, or the list
  // screen it was opened from.
  backLabel: string
  onBack: () => void
  onEdit: (meal: Meal) => void
  onDelete: (meal: Meal) => void
  // Logged from here, which the day on every other tab shows.
  onLogged: () => void
}) {
  const [meal, setMeal] = useState<Meal | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  const [saving, setSaving] = useState(false)
  // Asked before it goes, because there is no copy of a meal anywhere else.
  const [erasing, setErasing] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [notice, setNotice] = useState('')
  const [left, setLeft] = useState('')

  useTopBar({ title: meal?.name ?? 'Meal', back: { label: backLabel, onBack } })

  const reload = async () => {
    setMeal(await api<Meal>(`/meals/${id}`))
  }

  useEffect(() => {
    let alive = true
    api<Meal>(`/meals/${id}`)
      .then((loaded) => alive && setMeal(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [id])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => {
      setNotice('')
      setLeft('')
    }, NOTICE)
    return () => window.clearTimeout(timer)
  }, [notice])

  const log = async (amount: number | null, slot: Slot, byWeight: boolean) => {
    if (meal === null || amount === null) return
    setSaving(true)
    setRefusal('')
    try {
      const answer = await api<MealLogged>(`/meals/${meal.id}/log`, {
        method: 'POST',
        body: {
          date: today(me.timezone),
          slot,
          ...(byWeight ? { grams: amount } : { servings: amount }),
        },
      })
      setLogging(false)
      setNotice(`Logged ${meal.name} into ${SLOT_LABEL[slot].toLowerCase()}.`)
      setLeft(
        answer.skipped.length === 0
          ? ''
          : `${answer.skipped.join(', ')} ${
              answer.skipped.length === 1 ? 'was' : 'were'
            } left out because that food is gone.`
      )
      onLogged()
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  // What the whole meal weighs: what the scale said, or what the items come
  // to. The scale is what a share by weight is worked out from.
  const weight = meal === null ? null : (meal.final_weight_g ?? meal.weight_g)

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {meal && (
        <>
          {/* The bar above already says which meal this is. */}
          {weight !== null && (
            <p className="mb-3 text-sm text-muted">
              {meal.final_weight_g === null ? '' : 'Final weight '}
              {gramsText(weight)}
            </p>
          )}
          <DishPhoto
            kind="meal"
            id={meal.id}
            name={meal.name}
            url={meal.photo_url}
            onChanged={reload}
          />
          <div className="t-card mb-3">
            <PanelFacts values={meal.totals} />
          </div>

          <div className="t-card mb-3">
            <p className="t-micro mb-1">Items / amounts</p>
            {meal.items.map((row) => (
              <PartLine key={row.id} row={row} />
            ))}
          </div>

          <div className="t-actions mb-3">
            <button
              className="t-btn t-btn-primary flex-1"
              type="button"
              onClick={() => setLogging(true)}
            >
              Log
            </button>
            <DishAutoLog
              kind="meal"
              id={meal.id}
              name={meal.name}
              weight={weight}
              timezone={me.timezone}
              onChanged={onLogged}
            />
            <button className="t-btn" type="button" onClick={() => onEdit(meal)}>
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Edit
            </button>
            <button className="t-btn text-danger" type="button" onClick={() => setErasing(true)}>
              Delete
            </button>
          </div>

          <ConfirmSheet
            open={erasing}
            label={`Delete ${meal.name}?`}
            question={`Delete ${meal.name}?`}
            tone="danger"
            note="This meal is private to you and cannot be recovered."
            verb="Delete"
            onConfirm={() => onDelete(meal)}
            onClose={() => setErasing(false)}
          />

          {logging && (
            <LogSheet
              title="Log"
              action="Log"
              name={meal.name}
              servings={1}
              slot={slotByTime(me.timezone)}
              weight={weight}
              error={refusal}
              saving={saving}
              onClose={() => setLogging(false)}
              onSubmit={(amount, slot, byWeight) => void log(amount, slot, byWeight)}
            />
          )}

          {notice && (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
              <div className="mx-auto w-full max-w-md rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
                <span className="block">{notice}</span>
                {left && <span className="block text-muted">{left}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
