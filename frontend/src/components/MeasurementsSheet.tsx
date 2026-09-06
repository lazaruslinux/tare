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
import { dayLabel, today } from '../lib/day'

// How far back the sheet looks for a reading already on the chosen day, which
// is the same window the history list reads.
const WINDOW = 90

// Which form the sheet is showing. A day with nothing on it starts at the
// chooser; a day already recorded opens on what it holds.
type Mode = 'pick' | 'weight' | 'fat' | 'other' | 'edit'

// The numbers beyond the weight, in the order a scale prints them. Body fat
// leads: it is the one that has a form to itself.
type Extra = {
  key: 'body_fat_pct' | 'body_water_pct' | 'muscle_pct' | 'bone_pct'
  label: string
  // Stored as a share of the weight, but some scales print it as a mass, so
  // the field can be typed either way when the day has a weight.
  mass?: boolean
  unit?: string
}

const EXTRAS: Extra[] = [
  { key: 'body_fat_pct', label: 'Body fat', unit: '%' },
  { key: 'body_water_pct', label: 'Body water', unit: '%' },
  { key: 'muscle_pct', label: 'Muscle', unit: '%', mass: true },
  { key: 'bone_pct', label: 'Bone', unit: '%', mass: true },
]

// Which way each mass-or-share field is typed, kept on the device: a scale
// prints the same way every morning.
type FieldMode = 'pct' | 'mass'
const MODES_KEY = 'tare.measure.modes'

function readModes(): Record<string, FieldMode> {
  try {
    const raw = localStorage.getItem(MODES_KEY)
    return raw === null ? {} : (JSON.parse(raw) as Record<string, FieldMode>)
  } catch {
    return {}
  }
}

// Whether a recorded day carries any of the three behind the button. Body fat
// is asked for above them and is never one of them.
const hasDetails = (row: Measurement | undefined): boolean =>
  row !== undefined &&
  EXTRAS.some((extra) => extra.key !== 'body_fat_pct' && row[extra.key] !== null)

// A typed field as a number, or null for one left empty. A field somebody has
// not filled in is not a zero.
const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

type Fields = Record<string, string>

// What the sheet is called at the top of each form.
const LABEL: Record<Mode, string> = {
  pick: 'Biometrics',
  weight: 'Log weigh-in',
  fat: 'Log body fat',
  other: 'Log other measurements',
  edit: 'Biometrics',
}

export function MeasurementsSheet({
  me,
  date,
  onClose,
  onSaved,
  onDelete,
  weighIn,
}: {
  me: Me
  // The day being recorded. The Journal hands over the day on screen, and
  // everywhere else hands over today.
  date: string
  onClose: () => void
  onSaved: () => void
  // Only the screens that list past days hand this over; today from the
  // Dashboard has nothing to take back.
  onDelete?: () => void
  // Straight to the weigh-in form, for the screen that only wants a weight.
  // A day already recorded still opens on what it holds.
  weighIn?: boolean
}) {
  const units = me.units
  const day = date
  // The chooser until the day comes back. A day already recorded opens on
  // what it holds instead, unless the reader has already picked a form.
  const [mode, setMode] = useState<Mode>(weighIn ? 'weight' : 'pick')
  const [weight, setWeight] = useState('')
  const [fields, setFields] = useState<Fields>({})
  const [modes, setModes] = useState<Record<string, FieldMode>>(readModes)
  // The three details stay folded away until asked for, and unfold by
  // themselves for a day that already carries one.
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
        if (found !== undefined) {
          setMode((current) => (current === 'pick' || current === 'weight' ? 'edit' : current))
        }
        setWeight(
          found === undefined || found.weight_kg === null
            ? ''
            : String(weightIn(found.weight_kg, units)),
        )
        setFields(found === undefined ? {} : filled(found, units, modes))
        if (hasDetails(found)) setMore(true)
      })
      .catch(() => {
        // Nothing prefilled is the same screen as nothing recorded, and the
        // save below still says whatever the server says.
      })
    return () => {
      alive = false
    }
  }, [day, units])

  const typed = asNumber(weight)
  const kg = typed === null ? null : weightFrom(typed, units)
  // A mass is a share of something. Without a weight on the day there is
  // nothing to work the share out against, so those fields are percentages.
  const byMass = (extra: Extra): boolean =>
    extra.mass === true && kg !== null && modes[extra.key] === 'mass'
  // Each form asks for its own: the weight alone, the body fat alone, the
  // three a scale adds beyond it, or on a recorded day whatever it holds.
  const shown =
    mode === 'weight'
      ? []
      : mode === 'fat'
        ? EXTRAS.slice(0, 1)
        : mode === 'other'
          ? EXTRAS.slice(1)
          : more
            ? EXTRAS
            : EXTRAS.slice(0, 1)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'pick') return
    if (mode === 'weight' && kg === null) {
      setError('Enter a weight.')
      return
    }
    const body: Record<string, number | null> = {}
    if (mode === 'weight' || mode === 'edit') body.weight_kg = kg
    for (const extra of shown) {
      const value = asNumber(fields[extra.key] ?? '')
      // A mass typed in is stored as the share of the weight it is.
      body[extra.key] =
        value === null || kg === null || !byMass(extra)
          ? value
          : (weightFrom(value, units) / kg) * 100
    }
    if (mode === 'fat' && body.body_fat_pct === null) {
      setError('Enter a body fat percentage.')
      return
    }
    if (mode === 'other' && shown.every((extra) => body[extra.key] === null)) {
      setError('Enter at least one measurement.')
      return
    }
    if (Object.values(body).every((value) => value === null)) {
      setError('Nothing to record.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api<Measurement>(`/health/measurements/${day}`, { method: 'PUT', body })
      onSaved()
    } catch (failure) {
      setError(errorText(failure))
      setSaving(false)
    }
  }

  if (mode === 'pick') {
    return (
      <Sheet open label="Biometrics" onClose={onClose}>
        <p className="t-micro mb-1">Biometrics</p>
        <button type="button" className="t-row w-full text-left" onClick={() => setMode('weight')}>
          Weight
        </button>
        <button type="button" className="t-row w-full text-left" onClick={() => setMode('fat')}>
          Body fat percentage
        </button>
        <button type="button" className="t-row w-full text-left" onClick={() => setMode('other')}>
          Other
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet open label={LABEL[mode]} tall onClose={onClose}>
      <form onSubmit={submit}>
        <p className="text-base font-semibold">{LABEL[mode]}</p>
        <p className="mb-3 text-xs text-muted">{dayLabel(day, today(me.timezone))}</p>

        {(mode === 'weight' || mode === 'edit') && (
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
        )}

        {shown.map((extra) => (
          <div key={extra.key} className="t-row">
            <label className="min-w-0 flex-1 text-sm" htmlFor={`measure-${extra.key}`}>
              {extra.label}
            </label>
            <input
              id={`measure-${extra.key}`}
              className="t-input max-w-[30%]"
              type="number"
              inputMode="decimal"
              step="0.1"
              placeholder={byMass(extra) ? weightUnit(units) : (extra.unit ?? '')}
              value={fields[extra.key] ?? ''}
              onChange={(event) => setFields({ ...fields, [extra.key]: event.target.value })}
            />
            {extra.mass === true && kg !== null && (
              <span className="flex shrink-0 gap-1">
                {(['pct', 'mass'] as FieldMode[]).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="t-choice px-2 py-1 text-xs"
                    aria-pressed={byMass(extra) === (choice === 'mass')}
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
        ))}

        {mode === 'edit' && !more && (
          <button type="button" className="t-btn mt-1" onClick={() => setMore(true)}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Add more details
          </button>
        )}

        {error && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={saving}>
          {mode === 'weight' ? 'Log weigh-in' : 'Save'}
        </button>
        {mode === 'edit' && onDelete !== undefined && (
          <button
            type="button"
            className="mt-2 flex min-h-11 w-full items-center justify-center text-sm text-danger"
            onClick={onDelete}
          >
            Delete these measurements
          </button>
        )}
      </form>
    </Sheet>
  )
}

// A recorded day back in the words the form is typed in: the share, or the
// mass it works out to when that is how this member types it.
function filled(row: Measurement, units: Me['units'], modes: Record<string, FieldMode>): Fields {
  const out: Fields = {}
  for (const extra of EXTRAS) {
    const value = row[extra.key]
    if (value === null) continue
    if (extra.mass && modes[extra.key] === 'mass' && row.weight_kg !== null) {
      const mass = extra.key === 'muscle_pct' ? row.muscle_kg : row.bone_kg
      out[extra.key] = mass === null ? '' : String(weightIn(mass, units))
    } else {
      out[extra.key] = String(round1(value))
    }
  }
  return out
}
