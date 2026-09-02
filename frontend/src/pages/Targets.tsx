import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, errorText, type Me, type Profile as ProfileRow, type Targets as TargetsRow } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { DISCLAIMER, GOAL_LABEL, LEVEL_LABEL, calText, monthText } from '../lib/targets'
import { DailyBudget } from './DailyBudget'
import { Energy } from './Energy'
import { WeightGoal } from './WeightGoal'

// The three screens under this one. Each is a sub-view with its own way back,
// and this page is the list that names them.
type View = 'weight' | 'energy' | 'budget' | null

const TITLE: Record<NonNullable<View>, string> = {
  weight: 'Weight goal',
  energy: 'Energy',
  budget: 'Daily budget',
}

// What a screen saves, and whether it worked. The answer is what lets a screen
// show "Saved." only when something really was.
export type Save = (body: Record<string, unknown>) => Promise<boolean>

function Row({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        <span className="block truncate text-xs text-muted">{value}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
    </button>
  )
}

export function Targets({
  me,
  onBack,
  onOpenProfile,
}: {
  me: Me
  onBack: () => void
  // The Energy screen sends people to their details, which live one screen
  // over rather than inside this one.
  onOpenProfile: () => void
}) {
  const [targets, setTargets] = useState<TargetsRow | null>(null)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [view, setView] = useState<View>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Both in one go: the screens below read the targets, and two of them read
  // the latest weigh-in, which only the profile carries.
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

  useTopBar(
    view === null
      ? { title: 'Targets', back: { label: 'More', onBack } }
      : { title: TITLE[view], back: { label: 'Targets', onBack: () => setView(null) } }
  )

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

  const gotIt = async () => {
    await api('/health/disclaimer', { method: 'POST' }).catch(() => undefined)
    await reload()
  }

  if (targets === null) {
    return error ? <p className="t-error mb-3">{error}</p> : null
  }

  if (view === 'weight') {
    return (
      <WeightGoal
        me={me}
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
  if (view === 'energy') {
    return (
      <Energy
        me={me}
        targets={targets}
        busy={busy}
        error={error}
        onSaved={reload}
        onSaveProfile={saveProfile}
        onOpenProfile={onOpenProfile}
      />
    )
  }
  if (view === 'budget') {
    return (
      <DailyBudget
        targets={targets}
        busy={busy}
        error={error}
        onSaveTargets={saveTargets}
      />
    )
  }

  // The glance value under each row: enough to answer the question without
  // opening the screen that owns it.
  // The same three parts the Energy screen's ring adds up, so the two agree.
  const chosen = targets.activity_options.find((row) => row.level === targets.activity_level)
  const dayTotal =
    targets.resting === null || chosen?.adds === null || chosen === undefined
      ? null
      : targets.resting + chosen.adds
  const weightValue =
    targets.goal === 'maintain'
      ? 'Maintain'
      : targets.projection === null
        ? GOAL_LABEL[targets.goal]
        : `${GOAL_LABEL[targets.goal]} · about ${monthText(targets.projection.month)}`
  const energyValue =
    dayTotal === null
      ? LEVEL_LABEL[targets.activity_level]
      : `${LEVEL_LABEL[targets.activity_level]} · about ${calText(
          dayTotal + targets.exercise_today
        )} today`
  const budgetValue = `${calText(targets.budget.calories)} cal · ${targets.budget.protein_g}/${
    targets.budget.carbs_g
  }/${targets.budget.fat_g} g`

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      {!targets.disclaimer_seen && (
        <div className="t-card mb-3">
          <p className="t-note">{DISCLAIMER}</p>
          <button type="button" className="t-btn t-btn-primary mt-3" onClick={gotIt}>
            Got it
          </button>
        </div>
      )}

      <div className="t-card mb-3">
        <Row label="Weight goal" value={weightValue} onOpen={() => setView('weight')} />
        <Row label="Energy" value={energyValue} onOpen={() => setView('energy')} />
        <Row label="Daily budget" value={budgetValue} onOpen={() => setView('budget')} />
      </div>

      <p className="t-note mb-3">
        Everything here is private to you. No other member and no administrator can see it.
      </p>
    </>
  )
}
