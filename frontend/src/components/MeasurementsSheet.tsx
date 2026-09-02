import { Plus } from 'lucide-react'
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
  key: 'body_fat_pct' | 'body_water_pct' | 'muscle_pct' | 'bone_pct' | 'visceral_fat'
  label: string
  // Stored as a share of the weight, but some scales print it as a mass, so
  // the field can be typed either way.
  mass?: boolean
  unit?: string
  hint?: string
}

const EXTRAS: Extra[] = [
  { key: 'body_fat_pct', label: 'Body fat', unit: '%' },
  { key: 'body_water_pct', label: 'Body water', unit: '%' },
  { key: 'muscle_pct', label: 'Muscle', unit: '%', mass: true },
  { key: 'bone_pct', label: 'Bone', unit: '%', mass: true },
  { key: 'visceral_fat', label: 'Visceral rating', hint: 'A whole number from your scale' },
]

// Which way each mass-or-share field is typed, kept on the device: a scale
// prints the same way every morning.
type Mode = 'pct' | 'mass'
const MODES_KEY = 'tare.measure.modes'

function readModes(): Record<string, Mode> {
  try {
    const raw = localStorage.getItem(MODES_KEY)
    return raw === null ? {} : (JSON.parse(raw) as Record<string, Mode>)
  } catch {
    return {}
  }
}

// Whether a recorded day carries anything beyond the weight.
const hasExtras = (row: Measurement | undefined): boolean =>
  row !== undefined && EXTRAS.some((extra) => row[extra.key] !== null)

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
  const [modes, setModes] = useState<Record<string, Mode>>(readModes)
  // The scale's extra numbers stay folded away until asked for, and unfold
  // by themselves for somebody who has recorded them before.
  const [more, setMore] = useState(false)
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
        setFields(found === undefined ? {} : filled(found, units, modes))
        if (hasExtras(found) || hasExtras(history.measurements[0])) setMore(true)
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
    const kg = weightFrom(weightKg, units)
    const body: Record<string, number | null> = { weight_kg: kg }
    for (const extra of EXTRAS) {
      const value = asNumber(fields[extra.key] ?? '')
      // A mass typed in is stored as the share of the weight it is.
      const asMass = extra.mass && modes[extra.key] === 'mass'
      body[extra.key] =
        value === null ? null : asMass ? (weightFrom(value, units) / kg) * 100 : value
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

        {!more ? (
          <button type="button" className="t-btn mt-1" onClick={() => setMore(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add more from your scale
          </button>
        ) : (
          <>
            <p className="t-micro mb-1">From your scale</p>
            {EXTRAS.map((extra) => {
              const mode: Mode = extra.mass && modes[extra.key] === 'mass' ? 'mass' : 'pct'
              return (
                <div key={extra.key} className="t-row">
                  <label className="min-w-0 flex-1" htmlFor={`measure-${extra.key}`}>
                    <span className="block text-sm">{extra.label}</span>
                    {extra.hint && <span className="block text-xs text-muted">{extra.hint}</span>}
                  </label>
                  <input
                    id={`measure-${extra.key}`}
                    className="t-input max-w-[30%]"
                    type="number"
                    inputMode="decimal"
                    step={extra.key === 'visceral_fat' ? '1' : '0.1'}
                    placeholder={mode === 'mass' ? weightUnit(units) : (extra.unit ?? '')}
                    value={fields[extra.key] ?? ''}
                    onChange={(event) =>
                      setFields({ ...fields, [extra.key]: event.target.value })
                    }
                  />
                  {extra.mass && (
                    <span className="flex shrink-0 gap-1">
                      {(['pct', 'mass'] as Mode[]).map((choice) => (
                        <button
                          key={choice}
                          type="button"
                          className="t-choice px-2 py-1 text-xs"
                          aria-pressed={mode === choice}
                          onClick={() => {
                            const next = { ...modes, [extra.key]: choice }
                            setModes(next)
                            setFields({ ...fields, [extra.key]: '' })
                            try {
                              localStorage.setItem(MODES_KEY, JSON.stringify(next))
                            } catch {
                              // Kept for this visit only; the chip still works.
                            }
                          }}
                        >
                          {choice === 'pct' ? '%' : weightUnit(units)}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )
            })}
          </>
        )}

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

// A recorded day back in the words the form is typed in: the share, or the
// mass it works out to when that is how this member types it.
function filled(row: Measurement, units: Me['units'], modes: Record<string, Mode>): Fields {
  const out: Fields = {}
  for (const extra of EXTRAS) {
    const value = row[extra.key]
    if (value === null) continue
    if (extra.mass && modes[extra.key] === 'mass') {
      const mass = extra.key === 'muscle_pct' ? row.muscle_kg : row.bone_kg
      out[extra.key] = mass === null ? '' : String(weightIn(mass, units))
    } else {
      out[extra.key] = String(round1(value))
    }
  }
  return out
}
