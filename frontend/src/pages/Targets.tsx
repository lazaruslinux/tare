import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { api, errorText, type Me, type Profile as ProfileRow, type Targets as TargetsRow } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { DISCLAIMER, GOAL_LABEL, LEVEL_LABEL, calText, monthText } from '../lib/targets'
import { ActivityLevels } from './ActivityLevels'
import { DailyBudget } from './DailyBudget'
import { WeightGoal } from './WeightGoal'

// The three screens under this one. Each is a sub-view with its own way back,
// and this page is the list that names them.
type View = 'weight' | 'activity' | 'budget' | null

const TITLE: Record<NonNullable<View>, string> = {
  weight: 'Weight goal',
  activity: 'Activity Levels',
  budget: 'Macro & Calorie Targets',
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
  // The Activity Levels screen sends people to their details, which live one screen
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
  if (view === 'activity') {
    return (
      <ActivityLevels
        me={me}
        targets={targets}
        missing={profile?.missing ?? []}
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
        missing={profile?.missing ?? []}
        busy={busy}
        error={error}
        onSaveTargets={saveTargets}
      />
    )
  }

  // The glance value under each row: enough to answer the question without
  // opening the screen that owns it.
  const weightValue =
    targets.goal === 'maintain'
      ? 'Maintain'
      : targets.projection === null
        ? GOAL_LABEL[targets.goal]
        : `${GOAL_LABEL[targets.goal]} · about ${monthText(targets.projection.month)}`
  // The level, and what the body uses before any of it. Without a profile
  // there is no resting figure, and the level stands on its own.
  const activityValue =
    targets.resting === null
      ? LEVEL_LABEL[targets.activity_level]
      : `${LEVEL_LABEL[targets.activity_level]} · ${calText(targets.resting)} cal at rest`
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
        <Row
          label="Activity Levels"
          value={activityValue}
          onOpen={() => setView('activity')}
        />
        <Row
          label="Macro & Calorie Targets"
          value={budgetValue}
          onOpen={() => setView('budget')}
        />
      </div>

      <p className="t-note mb-3">
        Everything here is private to you. No other member and no administrator can see it.
      </p>
    </>
  )
}
