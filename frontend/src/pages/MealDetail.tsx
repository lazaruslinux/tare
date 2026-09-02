import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Meal, type MealLogged, type Me } from '../api'
import { LogSheet } from '../components/LogSheet'
import { useTopBar } from '../hooks/useTopBar'
import { SLOT_LABEL, slotByTime, today, type Slot } from '../lib/day'
import { portionText } from '../lib/units'

// How long the line saying what was logged stays up.
const NOTICE = 5000

// One kept meal: what is in it, and the one thing it exists for.
export function MealDetail({
  id,
  me,
  onBack,
  onEdit,
  onDelete,
}: {
  id: number
  me: Me
  onBack: () => void
  onEdit: (meal: Meal) => void
  onDelete: (meal: Meal) => void
}) {
  const [meal, setMeal] = useState<Meal | null>(null)
  const [error, setError] = useState('')
  const [logging, setLogging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [notice, setNotice] = useState('')
  const [left, setLeft] = useState('')

  useTopBar({ title: meal?.name ?? 'Meal', back: { label: 'Food', onBack } })

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

  const log = async (slot: Slot) => {
    if (meal === null) return
    setSaving(true)
    setRefusal('')
    try {
      const answer = await api<MealLogged>(`/meals/${meal.id}/log`, {
        method: 'POST',
        body: { date: today(me.timezone), slot },
      })
      setLogging(false)
      const many = answer.entries.length === 1 ? '1 food' : `${answer.entries.length} foods`
      setNotice(`Logged ${many} into ${SLOT_LABEL[slot].toLowerCase()}.`)
      setLeft(
        answer.skipped.length === 0
          ? ''
          : `${answer.skipped.join(', ')} ${
              answer.skipped.length === 1 ? 'was' : 'were'
            } left out because that food is gone.`
      )
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {meal && (
        <>
          {/* The bar above already says which meal this is. */}
          <p className="mb-3 text-sm text-muted">
            Logs {meal.items.length === 1 ? 'one food' : `${meal.items.length} foods`} at once.
          </p>

          <div className="t-card mb-3">
            <p className="t-micro mb-1">In it</p>
            {meal.items.map((row) => (
              <div key={row.id} className="t-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {[row.brand, portionText(row)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {row.food_id === null && <span className="t-chip shrink-0">food is gone</span>}
              </div>
            ))}
          </div>

          <div className="t-actions mb-3">
            <button
              className="t-btn t-btn-primary flex-1"
              type="button"
              onClick={() => setLogging(true)}
            >
              Log all
            </button>
            <button className="t-btn" type="button" onClick={() => onEdit(meal)}>
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Edit
            </button>
            <button className="t-btn text-danger" type="button" onClick={() => onDelete(meal)}>
              Delete
            </button>
          </div>

          {logging && (
            <LogSheet
              title="Log"
              action="Log all"
              name={meal.name}
              servings={null}
              slot={slotByTime(me.timezone)}
              error={refusal}
              saving={saving}
              onClose={() => setLogging(false)}
              onSubmit={(_, slot) => void log(slot)}
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
