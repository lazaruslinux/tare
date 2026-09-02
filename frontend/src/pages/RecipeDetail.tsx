import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Me, type Recipe } from '../api'
import { LogSheet } from '../components/LogSheet'
import { PanelFacts, nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { SLOT_LABEL, slotByTime, today, type Slot } from '../lib/day'
import { portionText, servingsText } from '../lib/units'

// How long the line saying what was logged stays up.
const NOTICE = 5000

// One recipe: what a serving of it is worth, what went into it, and the three
// things to do with it.
export function RecipeDetail({
  id,
  me,
  backLabel,
  onBack,
  onEdit,
  onDelete,
}: {
  id: number
  me: Me
  // What the screen behind this one is called: the Food page, or the list
  // screen it was opened from.
  backLabel: string
  onBack: () => void
  onEdit: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
}) {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState('')
  // The panel reads a serving at a time, because that is what anybody eats.
  const [perServing, setPerServing] = useState(true)
  const [logging, setLogging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [notice, setNotice] = useState('')

  useTopBar({ title: recipe?.name ?? 'Recipe', back: { label: backLabel, onBack } })

  useEffect(() => {
    let alive = true
    api<Recipe>(`/recipes/${id}`)
      .then((loaded) => alive && setRecipe(loaded))
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

  const log = async (servings: number | null, slot: Slot) => {
    if (recipe === null || servings === null) return
    setSaving(true)
    setRefusal('')
    try {
      await api('/diary', {
        method: 'POST',
        body: { date: today(me.timezone), slot, recipe_id: recipe.id, amount: servings },
      })
      setLogging(false)
      setNotice(
        `Logged ${servingsText(servings)} into ${SLOT_LABEL[slot].toLowerCase()}.`
      )
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {recipe && (
        <>
          {/* The bar above already says which recipe this is. */}
          <p className="mb-3 text-sm text-muted">Makes {servingsText(recipe.yield_servings)}</p>

          <div className="t-card mb-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={perServing}
                className="t-chip aria-pressed:border-accent aria-pressed:text-text"
                onClick={() => setPerServing(true)}
              >
                Per serving
              </button>
              <button
                type="button"
                aria-pressed={!perServing}
                className="t-chip aria-pressed:border-accent aria-pressed:text-text"
                onClick={() => setPerServing(false)}
              >
                Whole recipe
              </button>
            </div>

            <PanelFacts
              values={perServing ? recipe.per_serving : recipe.totals}
              note={perServing ? 'One serving' : 'Everything in it'}
            />
          </div>

          <div className="t-card mb-3">
            <p className="t-micro mb-1">In it</p>
            {recipe.ingredients.map((row) => (
              <div key={row.id} className="t-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {portionText(row)}
                    {row.food_id === null && ' · this food is gone'}
                  </span>
                </span>
                <span className="t-nums shrink-0 text-sm">
                  {nutrientText('calories', row.calories)}
                </span>
              </div>
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
            <button className="t-btn" type="button" onClick={() => onEdit(recipe)}>
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Edit
            </button>
            <button className="t-btn text-danger" type="button" onClick={() => onDelete(recipe)}>
              Delete
            </button>
          </div>

          {logging && (
            <LogSheet
              title="Log"
              action="Log"
              name={recipe.name}
              servings={1}
              slot={slotByTime(me.timezone)}
              error={refusal}
              saving={saving}
              onClose={() => setLogging(false)}
              onSubmit={(servings, slot) => void log(servings, slot)}
            />
          )}

          {notice && (
            <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
              <div className="mx-auto w-full max-w-md rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
                {notice}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
