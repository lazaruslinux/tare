import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type Me, type Recipe } from '../api'
import { DishAutoLog, DishPhoto } from '../components/Dish'
import { PartLine } from '../components/FoodRows'
import { LogSheet } from '../components/LogSheet'
import { PanelFacts } from '../components/NutritionLabel'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import { SLOT_LABEL, slotByTime, today, type Slot } from '../lib/day'
import { gramsText, servingsText } from '../lib/units'

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
  onLogged,
}: {
  id: number
  me: Me
  // What the screen behind this one is called: the Food page, or the list
  // screen it was opened from.
  backLabel: string
  onBack: () => void
  onEdit: (recipe: Recipe) => void
  onDelete: (recipe: Recipe) => void
  // Logged from here, which the day on every other tab shows.
  onLogged: () => void
}) {
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [error, setError] = useState('')
  // The panel reads a serving at a time, because that is what anybody eats.
  const [perServing, setPerServing] = useState(true)
  const [logging, setLogging] = useState(false)
  const [saving, setSaving] = useState(false)
  // Asked before it goes, because there is no copy of a recipe anywhere else.
  const [erasing, setErasing] = useState(false)
  const [refusal, setRefusal] = useState('')
  const [notice, setNotice] = useState('')

  useTopBar({ title: recipe?.name ?? 'Recipe', back: { label: backLabel, onBack } })

  const reload = async () => {
    setRecipe(await api<Recipe>(`/recipes/${id}`))
  }

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

  const log = async (amount: number | null, slot: Slot, byWeight: boolean) => {
    if (recipe === null || amount === null) return
    setSaving(true)
    setRefusal('')
    try {
      await api('/diary', {
        method: 'POST',
        body: {
          date: today(me.timezone),
          slot,
          recipe_id: recipe.id,
          ...(byWeight ? { grams: amount } : { amount }),
        },
      })
      setLogging(false)
      setNotice(
        `Logged ${byWeight ? gramsText(amount) : servingsText(amount)} into ` +
          `${SLOT_LABEL[slot].toLowerCase()}.`
      )
      onLogged()
    } catch (failure) {
      setRefusal(errorText(failure))
    }
    setSaving(false)
  }

  // What the whole recipe weighs: what the scale said, or what the parts come
  // to. The scale is what a share by weight is worked out from.
  const weight = recipe === null ? null : (recipe.final_weight_g ?? recipe.weight_g)

  return (
    <>
      {error && <p className="t-error">{error}</p>}
      {recipe && (
        <>
          {/* The bar above already says which recipe this is. */}
          <p className="mb-3 text-sm text-muted">
            Makes {servingsText(recipe.yield_servings)}
            {weight !== null &&
              ` · ${recipe.final_weight_g === null ? '' : 'Final weight '}${gramsText(weight)}`}
          </p>
          <DishPhoto
            kind="recipe"
            id={recipe.id}
            name={recipe.name}
            url={recipe.photo_url}
            onChanged={reload}
          />

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

            <PanelFacts values={perServing ? recipe.per_serving : recipe.totals} />
          </div>

          <div className="t-card mb-3">
            <p className="t-micro mb-1">Items / amounts</p>
            {recipe.ingredients.map((row) => (
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
              kind="recipe"
              id={recipe.id}
              name={recipe.name}
              weight={weight}
              timezone={me.timezone}
              onChanged={onLogged}
            />
            <button className="t-btn" type="button" onClick={() => onEdit(recipe)}>
              <Pencil className="h-4 w-4" strokeWidth={2} />
              Edit
            </button>
            <button className="t-btn text-danger" type="button" onClick={() => setErasing(true)}>
              Delete
            </button>
          </div>

          <Sheet
            center
            open={erasing}
            label={`Delete ${recipe.name}?`}
            onClose={() => setErasing(false)}
          >
            <p className="text-base font-semibold tracking-tight text-danger">
              Delete {recipe.name}?
            </p>
            <p className="mt-2 text-sm text-muted">
              This recipe is private to you and cannot be recovered.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                className="t-btn t-btn-danger flex-1"
                onClick={() => onDelete(recipe)}
              >
                Delete
              </button>
              <button type="button" className="t-btn" onClick={() => setErasing(false)}>
                Cancel
              </button>
            </div>
          </Sheet>

          {logging && (
            <LogSheet
              title="Log"
              action="Log"
              name={recipe.name}
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
                {notice}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
