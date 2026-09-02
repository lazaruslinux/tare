import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import {
  api,
  errorText,
  type ActivityLevel,
  type Goal,
  type Me,
  type Rate,
  type Targets as TargetsRow,
} from '../api'
import { kgToLb, round1, weightFrom, weightIn, weightUnit } from '../lib/units'

// Decision 5's four levels, in the words the doc gives them.
const LEVELS: { value: ActivityLevel; label: string; note: string }[] = [
  { value: 'not_much', label: 'Not much', note: 'Desk work, little walking' },
  { value: 'light', label: 'Light', note: 'On your feet part of the day' },
  {
    value: 'moderate',
    label: 'Moderate',
    note: 'Physical job or on your feet most of the day',
  },
  { value: 'heavy', label: 'Heavy', note: 'Hard physical work all day' },
]

const GOALS: { value: Goal; label: string }[] = [
  { value: 'maintain', label: 'Maintain' },
  { value: 'lose', label: 'Lose weight' },
  { value: 'gain', label: 'Gain weight' },
]

// The paces, and what each of them is a week. Shown in whichever units the
// account reads in.
const RATE_KG: Record<Rate, number> = {
  gentle: 0.25,
  steady: 0.5,
  faster: 0.75,
  fastest: 1,
}

const RATE_LABEL: Record<Rate, string> = {
  gentle: 'Gentle',
  steady: 'Steady',
  faster: 'Faster',
  fastest: 'Fastest',
}

// Decision 30, word for word, said once and then reachable from the Guide.
const DISCLAIMER =
  'tare estimates. It is not medical advice. The numbers come from population ' +
  'averages and can be off by a few hundred calories for any one person. Talk to ' +
  'a clinician before changing how you eat if you are pregnant or breastfeeding, ' +
  'under care for a medical condition, or have a history of disordered eating.'

// Decision 18's second sentence, which always travels with the month.
const PACE_CAVEAT =
  'Bodies adapt, so the real date is usually later. The estimate updates as you weigh in.'

const CEILINGS: { key: keyof TargetsRow['budget']; label: string; unit: string }[] = [
  { key: 'fiber_g', label: 'Fiber, aim for', unit: 'g' },
  { key: 'saturated_fat_g_max', label: 'Saturated fat, under', unit: 'g' },
  { key: 'sugar_g_max', label: 'Added sugars, under', unit: 'g' },
  { key: 'sodium_mg_max', label: 'Sodium, under', unit: 'mg' },
  { key: 'cholesterol_mg_max', label: 'Cholesterol, under', unit: 'mg' },
]

const monthText = (iso: string): string =>
  new Date(`${iso}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })

const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        className="t-micro t-tap44 mt-3 flex items-center gap-1"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {label}
        <ChevronDown className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} strokeWidth={2.5} />
      </button>
      {open && <div className="mt-1">{children}</div>}
    </>
  )
}

export function Targets({ me }: { me: Me }) {
  const units = me.units
  const [targets, setTargets] = useState<TargetsRow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [goalWeight, setGoalWeight] = useState('')
  const [typed, setTyped] = useState<Record<string, string>>({})

  const take = (row: TargetsRow) => {
    setTargets(row)
    setGoalWeight(row.goal_weight_kg === null ? '' : String(weightIn(row.goal_weight_kg, units)))
    const source = row.manual ?? row.budget
    setTyped({
      calories: String(source.calories),
      protein_g: String(source.protein_g),
      carbs_g: String(source.carbs_g),
      fat_g: String(source.fat_g),
    })
  }

  useEffect(() => {
    let alive = true
    api<TargetsRow>('/health/targets')
      .then((row) => alive && take(row))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
    // Once, on the way in. Everything after that is a change made on this
    // screen, and each of those reads the answer back for itself.
  }, [])

  // Every change on this screen saves as it is made: there is no half-set
  // target worth keeping in a form.
  const change = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      await api('/health/profile', { method: 'PUT', body })
      take(await api<TargetsRow>('/health/targets'))
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const setMode = async (body: Record<string, unknown>) => {
    setBusy(true)
    setError('')
    try {
      take(await api<TargetsRow>('/health/targets', { method: 'PUT', body }))
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const dismiss = async (key: string) => {
    await api(`/health/nudges/${key}/dismiss`, { method: 'POST' }).catch(() => undefined)
    take(await api<TargetsRow>('/health/targets'))
  }

  const gotIt = async () => {
    await api('/health/disclaimer', { method: 'POST' }).catch(() => undefined)
    take(await api<TargetsRow>('/health/targets'))
  }

  if (targets === null) {
    return error ? <p className="t-error mb-3">{error}</p> : null
  }

  const rateText = (rate: Rate): string =>
    units === 'imperial'
      ? `${round1(kgToLb(RATE_KG[rate]))} lb a week`
      : `${RATE_KG[rate]} kg a week`

  const chosenRate = targets.rate
  const gated = targets.goal === 'lose' && targets.rates_offered.length === 2
  const offer = targets.reestimate

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      {!targets.disclaimer_seen && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">{DISCLAIMER}</p>
          <button type="button" className="t-btn t-btn-primary mt-3" onClick={gotIt}>
            Got it
          </button>
        </div>
      )}

      {targets.nudges.map((nudge) => (
        <div key={nudge.key} className="t-card mb-3">
          <p className="text-sm">{nudge.text}</p>
          <button
            type="button"
            className="mt-2 text-sm text-muted"
            onClick={() => dismiss(nudge.key)}
          >
            Dismiss
          </button>
        </div>
      ))}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">How active is your day?</p>
        {LEVELS.map((level) => (
          <button
            key={level.value}
            type="button"
            aria-pressed={targets.activity_level === level.value}
            disabled={busy}
            className="t-row w-full text-left aria-pressed:text-text"
            onClick={() => change({ activity_level: level.value })}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{level.label}</span>
              <span className="block text-xs text-muted">{level.note}</span>
            </span>
            {targets.activity_level === level.value && (
              <span className="t-chip text-accent">Chosen</span>
            )}
          </button>
        ))}
        <p className="mt-2 text-xs text-muted">
          This is your ordinary day without workouts. Exercise you log is added back
          on top.
        </p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Your goal</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {GOALS.map((goal) => (
            <button
              key={goal.value}
              type="button"
              aria-pressed={targets.goal === goal.value}
              disabled={busy}
              className="t-btn px-3 aria-pressed:border-accent aria-pressed:text-text"
              onClick={() => change({ goal: goal.value })}
            >
              {goal.label}
            </button>
          ))}
        </div>

        {targets.rates_offered.length > 0 && (
          <>
            <p className="t-micro mb-1">How fast?</p>
            {targets.rates_offered.map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={chosenRate === rate}
                disabled={busy}
                className="t-row w-full text-left aria-pressed:text-text"
                onClick={() => change({ rate })}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{RATE_LABEL[rate]}</span>
                  <span className="block text-xs text-muted">{rateText(rate)}</span>
                </span>
                {chosenRate === rate && <span className="t-chip text-accent">Chosen</span>}
              </button>
            ))}
            {gated && (
              <p className="mt-2 text-xs text-muted">
                tare offers the two faster paces only when your details suggest they
                suit you.
              </p>
            )}
          </>
        )}

        {targets.goal !== 'maintain' && (
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="targets-goal-weight">
              Goal weight ({weightUnit(units)})
            </label>
            <input
              id="targets-goal-weight"
              className="t-input max-w-[45%]"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={goalWeight}
              onChange={(event) => setGoalWeight(event.target.value)}
              onBlur={() => {
                const value = asNumber(goalWeight)
                change({
                  goal_weight_kg: value === null ? null : weightFrom(value, units),
                })
              }}
            />
          </div>
        )}
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-1">Your daily budget</p>
        <span className="t-nums block text-3xl font-semibold leading-tight">
          {targets.budget.calories}
        </span>
        <span className="block text-xs text-muted">Calories a day</span>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <span className="t-nums block text-lg font-semibold">
              {targets.budget.protein_g}
              <span className="text-sm font-normal text-muted">g</span>
            </span>
            <span className="block text-xs text-muted">Protein</span>
          </div>
          <div>
            <span className="t-nums block text-lg font-semibold">
              {targets.budget.carbs_g}
              <span className="text-sm font-normal text-muted">g</span>
            </span>
            <span className="block text-xs text-muted">Carbs</span>
          </div>
          <div>
            <span className="t-nums block text-lg font-semibold">
              {targets.budget.fat_g}
              <span className="text-sm font-normal text-muted">g</span>
            </span>
            <span className="block text-xs text-muted">Fat</span>
          </div>
        </div>

        {targets.notes.map((note) => (
          <p key={note} className="mt-3 text-xs text-muted">
            {note}
          </p>
        ))}

        {targets.projection !== null && (
          <p className="mt-3 text-sm">
            At this pace, about {monthText(targets.projection.month)}.
            <span className="block text-xs text-muted">{PACE_CAVEAT}</span>
          </p>
        )}

        {offer !== null && (
          <div className="mt-3">
            <p className="text-sm">
              Your weight is moving differently from the pace you picked. tare can
              set your budget to {offer.calories} calories a day.
            </p>
            <button
              type="button"
              className="t-btn mt-2"
              disabled={busy}
              onClick={() =>
                setMode({
                  mode: 'manual',
                  calories: offer.calories,
                  protein_g: targets.budget.protein_g,
                  carbs_g: targets.budget.carbs_g,
                  fat_g: targets.budget.fat_g,
                })
              }
            >
              Use that instead
            </button>
          </div>
        )}

        <Fold label="More targets">
          {CEILINGS.map((row) => (
            <div key={row.key} className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">{row.label}</span>
              <span className="t-nums">
                {targets.budget[row.key]} {row.unit}
              </span>
            </div>
          ))}
        </Fold>

        <Fold label="Adjust manually">
          {(['calories', 'protein_g', 'carbs_g', 'fat_g'] as const).map((key) => (
            <div key={key} className="t-row">
              <label className="flex-1 text-sm" htmlFor={`targets-${key}`}>
                {key === 'calories'
                  ? 'Calories'
                  : key === 'protein_g'
                    ? 'Protein (g)'
                    : key === 'carbs_g'
                      ? 'Carbs (g)'
                      : 'Fat (g)'}
              </label>
              <input
                id={`targets-${key}`}
                className="t-input max-w-[40%]"
                type="number"
                inputMode="decimal"
                step="1"
                value={typed[key] ?? ''}
                onChange={(event) => setTyped({ ...typed, [key]: event.target.value })}
              />
            </div>
          ))}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="t-btn t-btn-primary"
              disabled={busy}
              onClick={() =>
                setMode({
                  mode: 'manual',
                  calories: asNumber(typed.calories ?? ''),
                  protein_g: asNumber(typed.protein_g ?? ''),
                  carbs_g: asNumber(typed.carbs_g ?? ''),
                  fat_g: asNumber(typed.fat_g ?? ''),
                })
              }
            >
              Use these numbers
            </button>
            {targets.mode === 'manual' && (
              <button
                type="button"
                className="t-btn"
                disabled={busy}
                onClick={() => setMode({ mode: 'auto' })}
              >
                Back to automatic
              </button>
            )}
          </div>
        </Fold>
      </div>
    </>
  )
}
