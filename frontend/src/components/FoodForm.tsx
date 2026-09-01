import { ChevronDown, ChevronLeft, Plus, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { api, errorText, type Food } from '../api'
import type { BaseUnit } from '../lib/units'
import { HEADLINE, MORE_FACTS, type Nutrient } from './NutritionLabel'

// Two ways to measure a food, in the words somebody would use out loud.
const BASES: { value: BaseUnit; title: string; note: string }[] = [
  { value: 'g', title: 'Grams', note: 'Solids, weighed' },
  { value: 'ml', title: 'Millilitres', note: 'Liquids, poured' },
]

// Matches the bounds the server holds a density to. Said on screen only when
// somebody has gone outside them, because until then it is noise.
const DENSITY_MIN = 0.2
const DENSITY_MAX = 3
const DENSITY_HINT = `A millilitre weighs between ${DENSITY_MIN} and ${DENSITY_MAX} grams.`

const MAX_SERVINGS = 8

type ServingDraft = { name: string; amount: string }

// A typed field as a number, or nothing. An empty box is a nutrient the label
// did not give, which is not the same as zero of it.
function num(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function startingPanel(food: Food | null): Record<Nutrient, string> {
  const panel = {} as Record<Nutrient, string>
  for (const fact of [...HEADLINE, ...MORE_FACTS]) {
    const value = food ? food[fact.key] : null
    panel[fact.key] = value === null ? '' : String(value)
  }
  return panel
}

function startingServings(food: Food | null): ServingDraft[] {
  if (!food || food.servings.length === 0) return []
  return food.servings.map((serving) => ({
    name: serving.name,
    amount: String(serving.base_amount),
  }))
}

export function FoodForm({
  food,
  onSaved,
  onCancel,
}: {
  food: Food | null
  onSaved: (food: Food) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(food?.name ?? '')
  const [brand, setBrand] = useState(food?.brand ?? '')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(food?.base_unit ?? 'g')
  const [panel, setPanel] = useState(() => startingPanel(food))
  const [density, setDensity] = useState(
    food === null || food.density_g_per_ml === null ? '' : String(food.density_g_per_ml)
  )
  const [servings, setServings] = useState<ServingDraft[]>(() => startingServings(food))
  const [more, setMore] = useState(false)
  const [densityWrong, setDensityWrong] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const setFact = (key: Nutrient, value: string) => setPanel({ ...panel, [key]: value })

  const setServing = (index: number, draft: ServingDraft) =>
    setServings(servings.map((row, at) => (at === index ? draft : row)))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const weight = num(density)
    const outside = weight !== null && (weight < DENSITY_MIN || weight > DENSITY_MAX)
    setDensityWrong(outside)
    if (outside) {
      // Opened, or the reason for the refusal would be behind a fold.
      setMore(true)
      return
    }

    setSaving(true)
    setError('')
    const body: Record<string, unknown> = {
      name,
      brand,
      base_unit: baseUnit,
      density_g_per_ml: weight,
      servings: servings
        // A row somebody added and left alone is not a serving.
        .filter((row) => row.name.trim() || row.amount.trim())
        .map((row, position) => ({
          name: row.name,
          base_amount: num(row.amount) ?? 0,
          position,
        })),
    }
    for (const fact of [...HEADLINE, ...MORE_FACTS]) body[fact.key] = num(panel[fact.key])

    try {
      onSaved(
        await api<Food>(food ? `/foods/${food.id}` : '/foods', {
          method: food ? 'PATCH' : 'POST',
          body,
        })
      )
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <>
      <button type="button" className="t-micro mb-2 flex items-center gap-1" onClick={onCancel}>
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
        Food
      </button>
      <p className="mb-3 text-xl font-semibold tracking-tight">
        {food ? 'Edit food' : 'New food'}
      </p>

      <form onSubmit={submit}>
        <div className="t-card mb-3">
          <div className="mb-3">
            <label className="t-label" htmlFor="food-name">
              Name
            </label>
            <input
              id="food-name"
              className="t-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="t-label" htmlFor="food-brand">
              Brand (optional)
            </label>
            <input
              id="food-brand"
              className="t-input"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
            />
          </div>
        </div>

        <div className="mb-3">
          <p className="t-micro mb-2">Measured in</p>
          <div className="flex gap-3">
            {BASES.map((base) => (
              <button
                key={base.value}
                type="button"
                aria-pressed={baseUnit === base.value}
                className="t-choice"
                onClick={() => setBaseUnit(base.value)}
              >
                <span className="block text-sm font-semibold">{base.title}</span>
                <span className="block text-xs">{base.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-1">Per 100 {baseUnit}</p>
          {HEADLINE.map((fact) => (
            <div key={fact.key} className="t-row">
              <label className="flex-1 text-sm" htmlFor={`food-${fact.key}`}>
                {fact.label}
                {fact.unit && <span className="text-muted"> ({fact.unit})</span>}
              </label>
              <input
                id={`food-${fact.key}`}
                className="t-input t-nums max-w-[40%] text-right"
                inputMode="decimal"
                value={panel[fact.key]}
                onChange={(event) => setFact(fact.key, event.target.value)}
              />
            </div>
          ))}

          <button
            type="button"
            className="t-micro mt-3 flex items-center gap-1"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More facts
            <ChevronDown className={`h-3.5 w-3.5 ${more ? 'rotate-180' : ''}`} strokeWidth={2.5} />
          </button>

          {more && (
            <div className="mt-1">
              {MORE_FACTS.map((fact) => (
                <div key={fact.key} className="t-row">
                  <label className="flex-1 text-sm" htmlFor={`food-${fact.key}`}>
                    {fact.label} <span className="text-muted">({fact.unit})</span>
                  </label>
                  <input
                    id={`food-${fact.key}`}
                    className="t-input t-nums max-w-[40%] text-right"
                    inputMode="decimal"
                    value={panel[fact.key]}
                    onChange={(event) => setFact(fact.key, event.target.value)}
                  />
                </div>
              ))}
              <div className="t-row">
                <label className="flex-1 text-sm" htmlFor="food-density">
                  Weight of 1 ml <span className="text-muted">(g)</span>
                </label>
                <input
                  id="food-density"
                  className="t-input t-nums max-w-[40%] text-right"
                  inputMode="decimal"
                  value={density}
                  onChange={(event) => setDensity(event.target.value)}
                />
              </div>
              {densityWrong && <p className="t-error mt-2">{DENSITY_HINT}</p>}
              <p className="mt-2 text-xs text-muted">
                Only if the label gives both a weight and a volume for the same serving.
              </p>
            </div>
          )}
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-1">Servings</p>
          {servings.map((serving, index) => (
            <div key={index} className="t-row">
              <input
                className="t-input min-w-0 flex-1"
                placeholder="1 slice"
                aria-label={`Serving ${index + 1} name`}
                value={serving.name}
                onChange={(event) => setServing(index, { ...serving, name: event.target.value })}
              />
              <input
                className="t-input t-nums w-20 text-right"
                inputMode="decimal"
                placeholder="28"
                aria-label={`Serving ${index + 1} amount`}
                value={serving.amount}
                onChange={(event) => setServing(index, { ...serving, amount: event.target.value })}
              />
              <span className="w-6 text-xs text-muted">{baseUnit}</span>
              <button
                type="button"
                className="t-tap44 text-muted"
                aria-label={`Remove serving ${index + 1}`}
                onClick={() => setServings(servings.filter((_, at) => at !== index))}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {servings.length < MAX_SERVINGS && (
            <button
              type="button"
              className="t-micro mt-2 flex items-center gap-1"
              onClick={() => setServings([...servings, { name: '', amount: '' }])}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Add a serving
            </button>
          )}
          <p className="mt-2 text-xs text-muted">
            How much one of them is, in {baseUnit}. Up to {MAX_SERVINGS}.
          </p>
        </div>

        {error && <p className="t-error mb-3">{error}</p>}

        <div className="mb-3 flex gap-3">
          <button className="t-btn t-btn-primary flex-1" type="submit" disabled={saving}>
            Save
          </button>
          <button className="t-btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </>
  )
}
