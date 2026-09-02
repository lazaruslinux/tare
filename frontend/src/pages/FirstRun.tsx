import { useState, type FormEvent } from 'react'

import { api, errorText, type Me, type Sex, type Units } from '../api'
import { today } from '../lib/day'
import { heightParts, partsToCm, weightFrom, weightUnit } from '../lib/units'

// One screen, and every field on it can be left alone. What is asked for is
// what the numbers need and nothing more; the rest is under More, where it
// stays changeable.
const UNIT_CHOICES: { units: Units; title: string; note: string }[] = [
  { units: 'imperial', title: 'Pounds and ounces', note: 'lb, oz, fl oz' },
  { units: 'metric', title: 'Grams and millilitres', note: 'g, ml' },
]

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
]

const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

export function FirstRun({
  me,
  onDone,
}: {
  me: Me
  // The second argument asks the app to open Targets straight away, which is
  // the one place the numbers just entered turn into something to read.
  onDone: (me: Me, openTargets: boolean) => void
}) {
  const [units, setUnits] = useState<Units>(me.units)
  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const [sex, setSex] = useState<Sex | null>(null)
  const [feet, setFeet] = useState('')
  const [inches, setInches] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [weight, setWeight] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const centimetres = (): number | null => {
    if (units === 'metric') return asNumber(heightCm)
    const ft = asNumber(feet)
    if (ft === null) return null
    return partsToCm(ft, asNumber(inches) ?? 0)
  }

  const save = async (openTargets: boolean) => {
    setBusy(true)
    setError('')
    try {
      const who = await api<Me>('/account', {
        method: 'PATCH',
        body: { units, display_name: displayName },
      })

      // Only what was filled in. A field left alone is not an answer of
      // nothing, and sending null for it would clear what is already there.
      const profile: Record<string, unknown> = {}
      if (sex !== null) profile.sex = sex
      const cm = centimetres()
      if (cm !== null) profile.height_cm = Math.round(cm)
      if (location.trim()) profile.location = location
      if (Object.keys(profile).length > 0) {
        await api('/health/profile', { method: 'PUT', body: profile })
      }

      const weighed = asNumber(weight)
      if (weighed !== null) {
        // A weight is a measurement, dated today, so the trend starts here
        // rather than sitting in a field on a settings screen.
        await api(`/health/measurements/${today(who.timezone)}`, {
          method: 'PUT',
          body: { weight_kg: weightFrom(weighed, units) },
        })
      }
      onDone(who, openTargets)
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void save(true)
  }

  // The height fields read in whichever system was just picked, so switching
  // at the top changes the boxes underneath rather than the number in them.
  const metric = units === 'metric'
  const parts = heightParts(Number(heightCm) || 0)

  return (
    <div className="t-center">
      <form className="w-full max-w-sm" onSubmit={submit}>
        <p className="mb-1 text-xl font-semibold tracking-tight">A few things about you</p>
        <p className="mb-4 text-sm text-muted">
          Every one of these can be left for later, and changed under More.
        </p>

        <p className="t-label">How do you measure?</p>
        <div className="mb-4 flex gap-3">
          {UNIT_CHOICES.map((choice) => (
            <button
              key={choice.units}
              type="button"
              aria-pressed={units === choice.units}
              className="t-choice"
              onClick={() => {
                setUnits(choice.units)
                // Carry the height across rather than emptying it: somebody
                // who typed 5 ft 9 in should see 175 cm, not a blank box.
                if (choice.units === 'metric') {
                  const cm = centimetres()
                  setHeightCm(cm === null ? '' : String(Math.round(cm)))
                } else if (heightCm) {
                  setFeet(String(parts.feet))
                  setInches(String(parts.inches))
                }
              }}
            >
              <span className="block text-sm font-semibold">{choice.title}</span>
              <span className="block text-xs">{choice.note}</span>
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="t-label" htmlFor="first-display-name">
            What should we call you?
          </label>
          <input
            id="first-display-name"
            className="t-input"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>

        <p className="t-label">Sex</p>
        <div className="mb-1 flex gap-3">
          {SEXES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={sex === choice.value}
              className="t-choice"
              onClick={() => setSex(sex === choice.value ? null : choice.value)}
            >
              <span className="block text-sm font-semibold">{choice.label}</span>
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs text-muted">
          Used only to estimate how much energy your body uses.
        </p>

        <p className="t-label">Height</p>
        {metric ? (
          <input
            className="t-input mb-4"
            type="number"
            inputMode="numeric"
            placeholder="cm"
            aria-label="Height in centimetres"
            value={heightCm}
            onChange={(event) => setHeightCm(event.target.value)}
          />
        ) : (
          <div className="mb-4 flex gap-3">
            <input
              className="t-input"
              type="number"
              inputMode="numeric"
              placeholder="ft"
              aria-label="Height in feet"
              value={feet}
              onChange={(event) => setFeet(event.target.value)}
            />
            <input
              className="t-input"
              type="number"
              inputMode="numeric"
              placeholder="in"
              aria-label="Height in inches"
              value={inches}
              onChange={(event) => setInches(event.target.value)}
            />
          </div>
        )}

        <div className="mb-4">
          <label className="t-label" htmlFor="first-weight">
            Weight ({weightUnit(units)})
          </label>
          <input
            id="first-weight"
            className="t-input"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="t-label" htmlFor="first-location">
            City, State
          </label>
          <input
            id="first-location"
            className="t-input"
            autoComplete="address-level2"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
          />
        </div>

        {error && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-1 w-full" type="submit" disabled={busy}>
          Set your targets now
        </button>
        <button
          className="mt-3 w-full text-sm text-muted"
          type="button"
          disabled={busy}
          onClick={() => void save(false)}
        >
          Later, under More
        </button>
      </form>
    </div>
  )
}
