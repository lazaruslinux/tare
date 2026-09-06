import { Plus, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import {
  api,
  errorText,
  type Food,
  type Headline,
  type Meal,
  type Me,
  type Part,
  type Recipe,
} from '../api'
import { FoodPicker } from '../components/FoodPicker'
import { HEADLINE, nutrientText } from '../components/NutritionLabel'
import { ScanFlow } from '../components/ScanFlow'
import { useTopBar } from '../hooks/useTopBar'
import { portionText, scale, toBase, type Unit } from '../lib/units'

// The one form behind both a recipe and a kept meal. They are the same screen
// but for one thing: a recipe says how many servings it makes.

const SERVING = 'serving:'

// The words each kind is read in. Nothing here is shared between the two but
// the shape of the screen.
const WORDS = {
  recipe: {
    heading: { fresh: 'New recipe', edit: 'Edit recipe' },
    group: 'Ingredients',
    add: 'Add ingredient',
    path: '/recipes',
    empty: 'Nothing in it yet. Add the first ingredient.',
  },
  meal: {
    heading: { fresh: 'New meal', edit: 'Edit meal' },
    group: 'Foods',
    add: 'Add item',
    path: '/meals',
    empty: 'Nothing in it yet. Add the first food.',
  },
}

// One row being filled in. The unit is the one the server reads, which for a
// food's own serving is its id: the recipe keeps only the name. The four are
// what the row shows and what the line under the list adds up.
type Draft = Record<Headline, number | null> & {
  food_id: number | null
  unit: string | null
  name: string
  brand: string
  amount: number
  serving_label: string | null
}

// A portion just chosen, as a row.
function drafted(food: Food, amount: number, unit: string): Draft {
  const serving = unit.startsWith(SERVING)
    ? food.servings.find((row) => `${SERVING}${row.id}` === unit)
    : undefined
  const baseAmount = serving ? amount * serving.base_amount : toBase(food, amount, unit as Unit)
  const row = {
    food_id: food.id,
    unit,
    name: food.name,
    brand: food.brand,
    amount,
    serving_label: serving?.name ?? null,
  } as Draft
  for (const fact of HEADLINE) row[fact.key] = scale(food[fact.key], baseAmount)
  return row
}

// Everything in the list added up, by the rule the server totals by: a figure
// one part is missing is unknown for the whole, not less of it.
function summed(rows: Draft[], key: Headline): number | null {
  if (rows.some((row) => row[key] === null)) return null
  return rows.reduce((total, row) => total + (row[key] ?? 0), 0)
}

// A row as it comes back from the server: an ingredient or an item in a meal,
// both of which carry the four.
type Saved = Part & Partial<Record<Headline, number | null>>

// A row that is already saved, as one that can be sent back.
//
// A serving is kept by its name, which is all a recipe needs to read; sending
// it again needs the id, and only the food has that. A null unit is a row that
// can no longer be measured, and saving says so rather than guessing.
async function sendable(part: Saved): Promise<Draft> {
  const row = {
    food_id: part.food_id,
    unit: part.food_id === null ? null : part.unit,
    name: part.name,
    brand: part.brand,
    amount: part.amount,
    serving_label: part.serving_label,
  } as Draft
  for (const fact of HEADLINE) row[fact.key] = part[fact.key] ?? null
  if (part.food_id === null || part.serving_label === null) return row
  const food = await api<Food>(`/foods/${part.food_id}`).catch(() => null)
  const serving = food?.servings.find((one) => one.name === part.serving_label)
  return { ...row, unit: serving ? `${SERVING}${serving.id}` : null }
}

export function PartsForm({
  kind,
  me,
  recipe,
  meal,
  onSaved,
  onCancel,
}: {
  kind: 'recipe' | 'meal'
  me: Me
  // Whichever of the two is being edited, or neither when it is a new one.
  recipe?: Recipe | null
  meal?: Meal | null
  onSaved: (id: number) => void
  onCancel: () => void
}) {
  const words = WORDS[kind]
  const existing = kind === 'recipe' ? (recipe ?? null) : (meal ?? null)
  const parts: Saved[] = recipe?.ingredients ?? meal?.items ?? []

  const [name, setName] = useState(existing?.name ?? '')
  const [yields, setYields] = useState(String(recipe?.yield_servings ?? 4))
  // Null while the saved rows are being made sendable again.
  const [drafts, setDrafts] = useState<Draft[] | null>(existing === null ? [] : null)
  const [picking, setPicking] = useState(false)
  // The camera, opened from the picker. A packet in somebody's hand is faster
  // to scan than to spell, here as much as in the Journal.
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useTopBar({
    title: existing === null ? words.heading.fresh : words.heading.edit,
    back: { label: existing?.name ?? 'Food', onBack: onCancel },
  })

  useEffect(() => {
    if (existing === null) return
    let alive = true
    Promise.all(parts.map(sendable)).then((rows) => alive && setDrafts(rows))
    return () => {
      alive = false
    }
    // Read once, from the thing that was opened with the screen.
  }, [existing?.id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const rows = drafts ?? []
    if (rows.length === 0) {
      setError(words.empty)
      return
    }
    const gone = rows.find((row) => row.unit === null)
    if (gone) {
      setError(`Take out ${gone.name}. That food is gone, so it cannot be measured again.`)
      return
    }

    setSaving(true)
    setError('')
    const body: Record<string, unknown> = { name }
    const sent = rows.map((row) => ({ food_id: row.food_id, amount: row.amount, unit: row.unit }))
    if (kind === 'recipe') {
      body.yield_servings = Number(yields.trim())
      body.ingredients = sent
    } else {
      body.items = sent
    }

    try {
      const saved = await api<{ id: number }>(
        existing === null ? words.path : `${words.path}/${existing.id}`,
        { method: existing === null ? 'POST' : 'PUT', body }
      )
      onSaved(saved.id)
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  const rows = drafts ?? []

  return (
    <>
      <form onSubmit={submit}>
        <div className="t-card mb-3">
          <label className="t-label" htmlFor="parts-name">
            Name
          </label>
          <input
            id="parts-name"
            className="t-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {kind === 'recipe' && (
            <div className="t-row mt-3">
              <label className="flex-1 text-sm" htmlFor="parts-yield">
                Makes
              </label>
              <input
                id="parts-yield"
                className="t-input t-nums w-24 text-right"
                inputMode="decimal"
                value={yields}
                onChange={(event) => setYields(event.target.value)}
              />
              <span className="w-16 text-xs text-muted">servings</span>
            </div>
          )}
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-1">{words.group}</p>
          {rows.length === 0 ? (
            <p className="text-sm text-muted">{words.empty}</p>
          ) : (
            rows.map((row, index) => (
              <div key={index} className="t-row">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {row.unit === null
                      ? 'This food is gone. Take it out.'
                      : portionText({
                          amount: row.amount,
                          unit: row.serving_label === null ? row.unit : 'serving',
                          serving_label: row.serving_label,
                        })}
                  </span>
                </span>
                <span className="t-nums shrink-0 text-sm">
                  {nutrientText('calories', row.calories)}
                </span>
                <button
                  type="button"
                  className="t-tap44 shrink-0 text-muted"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => setDrafts(rows.filter((_, at) => at !== index))}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            ))
          )}
          <button
            type="button"
            className="t-micro mt-2 flex items-center gap-1"
            onClick={() => setPicking(true)}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            {words.add}
          </button>

          {rows.length > 0 && (
            <p className="t-nums mt-3 border-t border-line pt-2 text-xs text-muted">
              Total {nutrientText('calories', summed(rows, 'calories'))} cal ·{' '}
              {nutrientText('protein_g', summed(rows, 'protein_g'))}g protein ·{' '}
              {nutrientText('carbs_g', summed(rows, 'carbs_g'))}g carbs ·{' '}
              {nutrientText('fat_g', summed(rows, 'fat_g'))}g fat
            </p>
          )}
        </div>

        {error && <p className="t-error mb-3">{error}</p>}

        <div className="t-actions mb-3">
          <button className="t-btn t-btn-primary flex-1" type="submit" disabled={saving}>
            Save
          </button>
          <button className="t-btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>

      {picking && (
        <FoodPicker
          me={me}
          onClose={() => setPicking(false)}
          onPick={(food, amount, unit) => {
            setDrafts([...rows, drafted(food, amount, unit)])
            setPicking(false)
          }}
          onScan={() => {
            setPicking(false)
            setScanning(true)
          }}
        />
      )}

      {scanning && (
        <ScanFlow
          me={me}
          onClose={() => setScanning(false)}
          onChanged={() => {}}
          onPick={(food, amount, unit) => {
            setDrafts([...rows, drafted(food, amount, unit)])
            setScanning(false)
          }}
        />
      )}
    </>
  )
}
