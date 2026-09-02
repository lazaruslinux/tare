import { useEffect, useState, type FormEvent } from 'react'

import {
  api,
  errorText,
  type Me,
  type Measurement,
  type Measurements,
} from '../api'
import { round1, weightFrom, weightIn, weightUnit } from '../lib/units'
import { Sheet } from './Sheet'

// How far back the sheet looks for a reading already on the chosen day, which
// is the same window the history list reads.
const WINDOW = 90

// The optional numbers, in the order a scale prints them. Weight is not here:
// it is required and it comes first, above all of these.
type Extra = {
  key: 'body_fat_pct' | 'body_water_pct' | 'muscle_kg' | 'bone_kg' | 'visceral_fat'
  label: string
  // Whether the field is a weight, which is the only kind that converts.
  weight?: boolean
  unit?: string
  hint?: string
}

const EXTRAS: Extra[] = [
  { key: 'body_fat_pct', label: 'Body fat', unit: '%' },
  { key: 'body_water_pct', label: 'Body water', unit: '%' },
  { key: 'muscle_kg', label: 'Muscle', weight: true },
  { key: 'bone_kg', label: 'Bone', weight: true },
  { key: 'visceral_fat', label: 'Visceral rating', hint: 'A whole number from your scale' },
]

// A typed field as a number, or null for one left empty. A field somebody has
// not filled in is not a zero.
const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

type Fields = Record<string, string>

export function MeasurementsSheet({
  me,
  date,
  onClose,
  onSaved,
}: {
  me: Me
  // The day being recorded. The Journal hands over the day on screen, and
  // everywhere else hands over today.
  date: string
  onClose: () => void
  onSaved: () => void
}) {
  const units = me.units
  const [day, setDay] = useState(date)
  const [weight, setWeight] = useState('')
  const [fields, setFields] = useState<Fields>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // What is already recorded on the day, so a second visit corrects a reading
  // rather than starting from an empty form.
  useEffect(() => {
    let alive = true
    api<Measurements>(`/health/measurements?days=${WINDOW}`)
      .then((history) => {
        if (!alive) return
        const found = history.measurements.find((row) => row.date === day)
        setWeight(found === undefined ? '' : String(weightIn(found.weight_kg, units)))
        setFields(found === undefined ? {} : filled(found, units))
      })
      .catch(() => {
        // Nothing prefilled is the same screen as nothing recorded, and the
        // save below still says whatever the server says.
      })
    return () => {
      alive = false
    }
  }, [day, units])

  const weightKg = asNumber(weight)
  const fat = asNumber(fields.body_fat_pct ?? '')
  // Shown rather than asked for: it is the weight with the fat taken off it.
  const lean =
    weightKg === null || fat === null ? null : weightFrom(weightKg, units) * (1 - fat / 100)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (weightKg === null) {
      setError('Start with your weight.')
      return
    }
    setSaving(true)
    setError('')
    const body: Record<string, number | null> = { weight_kg: weightFrom(weightKg, units) }
    for (const extra of EXTRAS) {
      const value = asNumber(fields[extra.key] ?? '')
      body[extra.key] =
        value === null ? null : extra.weight ? weightFrom(value, units) : value
    }
    try {
      await api<Measurement>(`/health/measurements/${day}`, { method: 'PUT', body })
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  return (
    <Sheet open label="Measurements" tall onClose={onClose}>
      <form onSubmit={submit}>
        <p className="mb-3 text-base font-semibold">Measurements</p>

        <div className="mb-3">
          <label className="t-label" htmlFor="measure-date">
            Day
          </label>
          <input
            id="measure-date"
            className="t-input"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
        </div>

        <div className="mb-3">
          <label className="t-label" htmlFor="measure-weight">
            Weight ({weightUnit(units)})
          </label>
          <input
            id="measure-weight"
            className="t-input"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </div>

        <p className="t-micro mb-1">If your scale says</p>
        {EXTRAS.map((extra) => (
          <div key={extra.key} className="t-row">
            <label className="min-w-0 flex-1" htmlFor={`measure-${extra.key}`}>
              <span className="block text-sm">{extra.label}</span>
              {extra.hint && <span className="block text-xs text-muted">{extra.hint}</span>}
            </label>
            <input
              id={`measure-${extra.key}`}
              className="t-input max-w-[40%]"
              type="number"
              inputMode="decimal"
              step={extra.key === 'visceral_fat' ? '1' : '0.1'}
              placeholder={extra.weight ? weightUnit(units) : (extra.unit ?? '')}
              value={fields[extra.key] ?? ''}
              onChange={(event) =>
                setFields({ ...fields, [extra.key]: event.target.value })
              }
            />
          </div>
        ))}

        {lean !== null && (
          <p className="mt-2 text-xs text-muted">
            Lean weight: {weightIn(lean, units)} {weightUnit(units)}
          </p>
        )}

        {error && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={saving}>
          Save
        </button>
      </form>
    </Sheet>
  )
}

// A recorded day back in the words the form is typed in.
function filled(row: Measurement, units: Me['units']): Fields {
  const out: Fields = {}
  for (const extra of EXTRAS) {
    const value = row[extra.key]
    if (value === null) continue
    out[extra.key] = String(extra.weight ? weightIn(value, units) : round1(value))
  }
  return out
}
