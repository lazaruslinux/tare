import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'

import {
  api,
  errorText,
  type Me,
  type Profile as ProfileRow,
  type Sex,
  type SyncKey,
  type Targets as TargetsRow,
  type Units,
} from '../api'
import { TareWordmark } from '../components/TareWordmark'
import { today } from '../lib/day'
import { asNumber } from '../lib/targets'
import { heightParts, partsToCm, weightFrom, weightUnit } from '../lib/units'
import { ActivityLevels } from './ActivityLevels'
import { SyncDevice } from './SyncDevice'
import type { Save } from './Targets'
import { WeightGoal } from './WeightGoal'

// The way in, in four short steps. Each one saves through the same endpoint the
// screen that owns it uses, and every one of them can be skipped: what is asked
// for here is what the numbers need, and all of it stays changeable under More.
const HEADINGS = [
  'A few things about you',
  'How active are you most days?',
  'Set a weight goal',
  'Connect your phone',
]

const UNIT_CHOICES: { units: Units; title: string; note: string }[] = [
  { units: 'imperial', title: 'Pounds and ounces', note: 'lb, oz, fl oz' },
  { units: 'metric', title: 'Grams and milliliters', note: 'g, ml' },
]

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
]

export function Setup({
  me,
  replay,
  onDone,
}: {
  me: Me
  // Whether this is somebody walking the flow again rather than arriving on it.
  replay: boolean
  onDone: (me: Me) => void
}) {
  const [step, setStep] = useState(1)
  // The account as the server has it. Step one changes it, and the steps after
  // read the units off it.
  const [account, setAccount] = useState(me)
  const [targets, setTargets] = useState<TargetsRow | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  // Whether a phone is already sending, which is what takes the last step away.
  const [synced, setSynced] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reduced = useReducedMotion()

  const [units, setUnits] = useState<Units>(me.units)
  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const [sex, setSex] = useState<Sex | null>(null)
  const [feet, setFeet] = useState('')
  const [inches, setInches] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [weight, setWeight] = useState('')
  const [location, setLocation] = useState('')

  // Both in one go, the same pair Targets loads: the two screens in the middle
  // read the targets, and one of them reads the latest weigh-in as well.
  const reload = useCallback(async () => {
    try {
      const [row, who] = await Promise.all([
        api<TargetsRow>('/health/targets'),
        api<ProfileRow>('/health/profile'),
      ])
      setTargets(row)
      setProfile(who)
    } catch (failure) {
      setError(errorText(failure))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    let alive = true
    api<SyncKey>('/account/ingest-token')
      // A key that has been used means the phone is already connected, so the
      // step that explains how is nothing to show.
      .then((row) => alive && setSynced(row.connected && row.last_used_at !== null))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const last = synced ? 3 : 4

  const send = async (path: string, body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      await api(path, { method: 'PUT', body })
      await reload()
      return true
    } catch (failure) {
      setError(errorText(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  const saveProfile: Save = (body) => send('/health/profile', body)
  const saveTargets: Save = (body) => send('/health/targets', body)

  const centimetres = (): number | null => {
    if (units === 'metric') return asNumber(heightCm)
    const ft = asNumber(feet)
    if (ft === null) return null
    return partsToCm(ft, asNumber(inches) ?? 0)
  }

  const saveAbout = async (): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      const who = await api<Me>('/account', {
        method: 'PATCH',
        body: { units, display_name: displayName },
      })
      setAccount(who)

      // Only what was filled in. A field left alone is not an answer of
      // nothing, and sending null for it would clear what is already there.
      const details: Record<string, unknown> = {}
      if (sex !== null) details.sex = sex
      const cm = centimetres()
      if (cm !== null) details.height_cm = Math.round(cm)
      if (location.trim()) details.location = location
      if (Object.keys(details).length > 0) {
        await api('/health/profile', { method: 'PUT', body: details })
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
      // Read back, so the weight goal step sees what was just weighed.
      await reload()
      return true
    } catch (failure) {
      setError(errorText(failure))
      return false
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    setError('')
    try {
      // A replay has nothing to stamp; the account recorded this the first time
      // through. Read the account back afterwards so what the app routes on is
      // the server's rather than this screen's copy of it.
      if (!replay && account.first_run_pending) {
        await api('/account/first-run', { method: 'POST' })
      }
      onDone(await api<Me>('/auth/me'))
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  const go = (to: number) => {
    setError('')
    if (to > last) {
      void finish()
      return
    }
    setStep(to)
  }

  const forward = async () => {
    if (step === 1 && !(await saveAbout())) return
    go(step + 1)
  }

  // The height fields read in whichever system was just picked, so switching
  // at the top changes the boxes underneath rather than the number in them.
  const metric = units === 'metric'
  const parts = heightParts(Number(heightCm) || 0)

  const about = (
    <>
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
              // Carry the height across rather than emptying it: somebody who
              // typed 5 ft 9 in should see 175 cm, not a blank box.
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
        <label className="t-label" htmlFor="setup-display-name">
          What should we call you?
        </label>
        <input
          id="setup-display-name"
          className="t-input"
          autoComplete="nickname"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <p className="t-label">Gender</p>
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
        <label className="t-label" htmlFor="setup-weight">
          Weight ({weightUnit(units)})
        </label>
        <input
          id="setup-weight"
          className="t-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
        />
      </div>

      <div className="mb-4">
        <label className="t-label" htmlFor="setup-location">
          City, State
        </label>
        <input
          id="setup-location"
          className="t-input"
          autoComplete="address-level2"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>
    </>
  )

  // The middle two steps stand on the targets, so they wait for them. The error
  // line below says why if they never arrive.
  const body = () => {
    if (step === 1) return about
    if (step === 4) return <SyncDevice />
    if (targets === null) return null
    if (step === 2) {
      return (
        <ActivityLevels
          me={account}
          targets={targets}
          missing={profile?.missing ?? []}
          busy={busy}
          error={error}
          onSaveProfile={saveProfile}
          onOpenProfile={() => go(1)}
        />
      )
    }
    return (
      <WeightGoal
        me={account}
        targets={targets}
        profile={profile}
        busy={busy}
        error={error}
        onSaved={reload}
        onSaveProfile={saveProfile}
        onSaveTargets={saveTargets}
      />
    )
  }

  return (
    <div className="t-center">
      <div className="w-full max-w-lg">
        <p className="mb-5 flex justify-center">
          <TareWordmark size={32} />
        </p>

        <div className="mb-2 flex min-h-6 items-center justify-between">
          {step > 1 ? (
            <button type="button" className="text-sm text-muted" onClick={() => go(step - 1)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <p className="t-micro">
            Step {step} of {last}
          </p>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: reduced ? 0 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : -24 }}
            transition={{ duration: 0.18 }}
          >
            <p
              className={`text-xl font-semibold tracking-tight ${step === 1 ? 'mb-1' : 'mb-4'}`}
            >
              {HEADINGS[step - 1]}
            </p>
            {body()}
          </motion.div>
        </AnimatePresence>

        {/* The two steps in the middle draw this line themselves. */}
        {(step === 1 || step === 4) && error && <p className="t-error mt-3">{error}</p>}

        <button
          className="t-btn t-btn-primary mt-1 w-full"
          type="button"
          disabled={busy}
          onClick={() => void forward()}
        >
          {step === last ? 'Done' : 'Continue'}
        </button>
        <button
          className="mt-3 w-full text-sm text-muted"
          type="button"
          disabled={busy}
          onClick={() => go(step + 1)}
        >
          {step === last ? "I'll do this later" : 'Skip'}
        </button>
      </div>
    </div>
  )
}
