import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Me, type Profile as ProfileRow, type Sex } from '../api'
import { dayLabel, today } from '../lib/day'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { heightParts, partsToCm, weightText } from '../lib/units'

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
]

const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

export function Profile({
  me,
  onChange,
  onAddMeasurement,
}: {
  me: Me
  onChange: (me: Me) => void
  // The one thing on this screen that is not a setting: a weight is a
  // measurement, and it is recorded where measurements are.
  onAddMeasurement: () => void
}) {
  const metric = me.units === 'metric'
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [sex, setSex] = useState<Sex | null>(null)
  const [feet, setFeet] = useState('')
  const [inches, setInches] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [location, setLocation] = useState('')
  const [expecting, setExpecting] = useState(false)
  const [error, setError] = useState('')
  const [saved, markSaved] = useSavedChip()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    api<ProfileRow>('/health/profile')
      .then((loaded) => {
        if (!alive) return
        setProfile(loaded)
        setSex(loaded.sex)
        setBirthdate(loaded.birthdate ?? '')
        setLocation(loaded.location ?? '')
        setExpecting(loaded.pregnant_or_breastfeeding)
        if (loaded.height_cm === null) return
        setHeightCm(String(Math.round(loaded.height_cm)))
        const parts = heightParts(loaded.height_cm)
        setFeet(String(parts.feet))
        setInches(String(parts.inches))
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  const centimetres = (): number | null => {
    if (metric) return asNumber(heightCm)
    const ft = asNumber(feet)
    if (ft === null) return null
    return partsToCm(ft, asNumber(inches) ?? 0)
  }

  // What is on screen against what was loaded, so Save is offered only when
  // there is something to save.
  const height = centimetres()
  const dirty =
    profile !== null &&
    (sex !== profile.sex ||
      (height === null ? null : Math.round(height)) !==
        (profile.height_cm === null ? null : Math.round(profile.height_cm)) ||
      birthdate !== (profile.birthdate ?? '') ||
      location !== (profile.location ?? '') ||
      expecting !== profile.pregnant_or_breastfeeding)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      // The birthdate lives on the account rather than the profile, and it is
      // held to the same rule the front door holds everybody to.
      if (birthdate && birthdate !== (profile?.birthdate ?? '')) {
        onChange(await api<Me>('/account', { method: 'PATCH', body: { birthdate } }))
      }
      const cm = centimetres()
      setProfile(
        await api<ProfileRow>('/health/profile', {
          method: 'PUT',
          body: {
            sex,
            height_cm: cm === null ? null : Math.round(cm),
            location,
            pregnant_or_breastfeeding: expecting,
          },
        })
      )
      markSaved()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSaving(false)
  }

  return (
    <form className="t-card mb-3" onSubmit={save}>
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
        <label className="t-label" htmlFor="profile-birthdate">
          Date of birth
        </label>
        <input
          id="profile-birthdate"
          className="t-input"
          type="date"
          autoComplete="bday"
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
        />
        <p className="mt-1 text-xs text-muted">tare is for adults 18 and over.</p>
      </div>

      <div className="mb-4">
        <label className="t-label" htmlFor="profile-location">
          City, State
        </label>
        <input
          id="profile-location"
          className="t-input"
          autoComplete="address-level2"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>

      <div className="t-row">
        <span className="flex-1 text-sm">Pregnant or breastfeeding</span>
        <button
          type="button"
          role="switch"
          aria-checked={expecting}
          className="t-btn px-3 aria-checked:border-accent aria-checked:text-text"
          onClick={() => setExpecting(!expecting)}
        >
          {expecting ? 'On' : 'Off'}
        </button>
      </div>

      <div className="t-row">
        <span className="flex-1 text-sm">Latest weight</span>
        <button type="button" className="text-sm text-accent" onClick={onAddMeasurement}>
          {profile === null || profile.latest_weight_kg === null
            ? 'Add'
            : `${weightText(profile.latest_weight_kg, me.units)}${
                profile.latest_weight_date === null
                  ? ''
                  : ` · ${dayLabel(profile.latest_weight_date, today(me.timezone))}`
              }`}
        </button>
      </div>

      {profile !== null && profile.bmi !== null && (
        <div className="t-row">
          <span className="flex-1 text-sm">Body mass index</span>
          <span className="t-nums text-right text-sm">{profile.bmi}</span>
        </div>
      )}

      {error && <p className="t-error mt-3">{error}</p>}

      <div className="mt-3 flex items-center gap-3">
        <button className="t-btn t-btn-primary" type="submit" disabled={saving || !dirty}>
          Save
        </button>
        <SaveMarks dirty={dirty} saved={saved} />
      </div>

      <p className="mt-3 text-xs text-muted">
        Everything on this screen is private to you. No other member and no
        administrator can see it.
      </p>
    </form>
  )
}
