import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { BudgetFigures, DayEnergy, Goal, TargetMode, Targets as TargetsRow } from '../api'
import { BreakdownCard } from '../components/BreakdownCard'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { SPLIT_NOTES, asNumber, calText, notesFor, personalNumber } from '../lib/targets'
import type { Save } from './Targets'

const MODES: { value: TargetMode; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'pct', label: 'Percentages' },
  { value: 'grams', label: 'Grams' },
]

// The three, and what a gram of each is worth.
const MACROS: { key: 'protein' | 'carbs' | 'fat'; label: string; perGram: number }[] = [
  { key: 'protein', label: 'Protein', perGram: 4 },
  { key: 'carbs', label: 'Carbs', perGram: 4 },
  { key: 'fat', label: 'Fat', perGram: 9 },
]

const CEILINGS: { key: keyof BudgetFigures; label: string; unit: string }[] = [
  { key: 'fiber_g', label: 'Fiber, aim for', unit: 'g' },
  { key: 'saturated_fat_g_max', label: 'Saturated fat, under', unit: 'g' },
  { key: 'sugar_g_max', label: 'Added sugars, under', unit: 'g' },
  { key: 'sodium_mg_max', label: 'Sodium, under', unit: 'mg' },
  { key: 'cholesterol_mg_max', label: 'Cholesterol, under', unit: 'mg' },
]

const PCT_SUM = 'The three percentages have to add up to 100.'

// Short enough that three of them sit on a phone beside their numbers.
const PRESET_LABEL: Record<Goal, string> = {
  lose: 'Lose',
  maintain: 'Maintain',
  gain: 'Gain',
}

const GRAM_KEYS = ['protein_g', 'carbs_g', 'fat_g'] as const
const PCT_KEYS = ['protein_pct', 'carbs_pct', 'fat_pct'] as const

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

export function DailyBudget({
  targets,
  missing,
  busy,
  error,
  onSaveTargets,
  onOpenGuide,
}: {
  targets: TargetsRow
  // Which of the four details are still missing, so the line about a personal
  // number names the gap.
  missing: string[]
  busy: boolean
  error: string
  onSaveTargets: Save
  // The Guide the line under these ceilings promises.
  onOpenGuide: () => void
}) {
  const [view, setView] = useState<TargetMode>(targets.mode)
  const [saved, markSaved] = useSavedChip()

  // The worked-out day, whichever way the split is set. A percentage divides
  // this number, never a number somebody typed.
  const autoCalories = targets.breakdown?.budget ?? targets.budget.calories

  const [pct, setPct] = useState<Record<string, string>>({
    protein_pct: String(targets.percentages.protein_pct),
    carbs_pct: String(targets.percentages.carbs_pct),
    fat_pct: String(targets.percentages.fat_pct),
  })
  const source = targets.manual ?? targets.budget
  const [grams, setGrams] = useState<Record<string, string>>({
    calories: String(source.calories),
    protein_g: String(source.protein_g),
    carbs_g: String(source.carbs_g),
    fat_g: String(source.fat_g),
  })

  const total = PCT_KEYS.reduce((sum, key) => sum + (asNumber(pct[key] ?? '') ?? 0), 0)
  const pctDirty =
    targets.mode !== 'pct' ||
    PCT_KEYS.some((key) => (asNumber(pct[key] ?? '') ?? 0) !== targets.percentages[key])
  const gramsDirty =
    targets.mode !== 'grams' ||
    (asNumber(grams.calories ?? '') ?? 0) !== targets.budget.calories ||
    GRAM_KEYS.some((key) => (asNumber(grams[key] ?? '') ?? 0) !== targets.budget[key])

  const choose = async (next: TargetMode) => {
    setView(next)
    // Automatic has nothing to fill in, so picking it is the change itself.
    if (next === 'auto' && targets.mode !== 'auto') {
      if (await onSaveTargets({ mode: 'auto' })) markSaved()
    }
  }

  const savePct = async () => {
    const body: Record<string, unknown> = { mode: 'pct' }
    for (const key of PCT_KEYS) body[key] = asNumber(pct[key] ?? '')
    if (await onSaveTargets(body)) markSaved()
  }

  const saveGrams = async () => {
    const body: Record<string, unknown> = { mode: 'grams', calories: asNumber(grams.calories ?? '') }
    for (const key of GRAM_KEYS) body[key] = asNumber(grams[key] ?? '')
    if (await onSaveTargets(body)) markSaved()
  }

  const usePreset = (goal: Goal) => {
    const split = targets.presets[goal]
    setPct({
      protein_pct: String(split.protein_pct),
      carbs_pct: String(split.carbs_pct),
      fat_pct: String(split.fat_pct),
    })
  }

  const backToAuto = async () => {
    setView('auto')
    if (await onSaveTargets({ mode: 'auto' })) markSaved()
  }

  // The losing split is the one that explains itself, and only while it is
  // what is in the fields.
  const lose = targets.presets.lose
  const onLosePreset = PCT_KEYS.every(
    (key) => (asNumber(pct[key] ?? '') ?? 0) === lose[key]
  )

  const breakdown = targets.breakdown
  // The same five figures the Journal folds out, from what this screen was
  // sent. Exercise is added back on the last line so the four above it add up.
  const energy: DayEnergy | null =
    view === 'auto' && targets.complete && breakdown !== null
      ? {
          resting: targets.resting ?? 0,
          activity:
            targets.activity_options.find((option) => option.level === targets.activity_level)
              ?.adds ?? 0,
          level: targets.activity_level,
          exercise: targets.exercise_today,
          adjustment: breakdown.adjustment,
          budget: breakdown.budget + targets.exercise_today,
        }
      : null
  const notes = notesFor(targets.note_keys, targets.notes, SPLIT_NOTES)

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      <BreakdownCard energy={energy}>
        <p className="t-micro mb-1">Your daily budget</p>
        <span className="t-nums block text-3xl font-semibold leading-tight">
          {calText(targets.budget.calories)}
        </span>
        <span className="block text-xs text-muted">cal a day</span>

        {breakdown === null && (
          <p className="t-note mt-2">{personalNumber(missing).label}.</p>
        )}
      </BreakdownCard>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Set Protein, Carbs and Fat by</p>
        <div className="mb-3 flex gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={view === mode.value}
              disabled={busy}
              className="t-choice px-2 py-3 text-center"
              onClick={() => void choose(mode.value)}
            >
              <span className="block text-sm font-semibold">{mode.label}</span>
            </button>
          ))}
        </div>

        {view === 'auto' && (
          <>
            {MACROS.map((macro) => {
              const gramsOf = targets.budget[`${macro.key}_g` as keyof BudgetFigures]
              const share = targets.percentages[`${macro.key}_pct` as keyof typeof targets.percentages]
              return (
                <div key={macro.key} className="t-row min-h-9 text-sm">
                  <span className="flex-1 text-muted">{macro.label}</span>
                  <span className="t-nums">
                    {gramsOf} g
                    <span className="text-muted">
                      {' '}
                      · {calText(Math.round(gramsOf * macro.perGram))} cal · {share}%
                    </span>
                  </span>
                </div>
              )
            })}
            <p className="t-note mt-3">
              Tare works these out from your details and your goal. You can set them
              yourself instead.
            </p>
          </>
        )}

        {view === 'pct' && (
          <>
            <p className="t-micro mb-2">Start from</p>
            <div className="mb-3 flex flex-wrap gap-2">
              {(Object.keys(targets.presets) as Goal[]).map((goal) => (
                <button
                  key={goal}
                  type="button"
                  className="t-btn px-3"
                  disabled={busy}
                  onClick={() => usePreset(goal)}
                >
                  {PRESET_LABEL[goal]} {targets.presets[goal].protein_pct}/
                  {targets.presets[goal].carbs_pct}/{targets.presets[goal].fat_pct}
                </button>
              ))}
            </div>
            {onLosePreset && targets.preset_notes.lose !== undefined && (
              <p className="t-note mb-3">{targets.preset_notes.lose}</p>
            )}

            {MACROS.map((macro) => {
              const key = `${macro.key}_pct`
              const share = asNumber(pct[key] ?? '') ?? 0
              const cal = Math.round((autoCalories * share) / 100)
              return (
                <div key={macro.key} className="t-row">
                  <label className="min-w-0 flex-1 text-sm" htmlFor={`budget-${key}`}>
                    <span className="block">{macro.label}</span>
                    <span className="t-nums block text-xs text-muted">
                      {Math.round(cal / macro.perGram)} g · {calText(cal)} cal
                    </span>
                  </label>
                  <input
                    id={`budget-${key}`}
                    className="t-input max-w-[6rem]"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={pct[key] ?? ''}
                    onChange={(event) => setPct({ ...pct, [key]: event.target.value })}
                  />
                </div>
              )
            })}

            <p className={`mt-2 text-sm ${total === 100 ? 'text-muted' : 'text-danger'}`}>
              Total {total}%
            </p>
            {total !== 100 && <p className="t-error mt-1">{PCT_SUM}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="t-btn t-btn-primary"
                disabled={busy || total !== 100 || !pctDirty}
                onClick={() => void savePct()}
              >
                Save
              </button>
              <button type="button" className="t-btn" disabled={busy} onClick={() => void backToAuto()}>
                Back to automatic
              </button>
              <SaveMarks dirty={pctDirty && total === 100} saved={saved} />
            </div>
          </>
        )}

        {view === 'grams' && (
          <>
            <div className="t-row">
              <label className="flex-1 text-sm" htmlFor="budget-calories">
                Calories
              </label>
              <input
                id="budget-calories"
                className="t-input max-w-[7rem]"
                type="number"
                inputMode="numeric"
                step="1"
                value={grams.calories ?? ''}
                onChange={(event) => setGrams({ ...grams, calories: event.target.value })}
              />
            </div>
            {MACROS.map((macro) => {
              const key = `${macro.key}_g`
              return (
                <div key={macro.key} className="t-row">
                  <label className="flex-1 text-sm" htmlFor={`budget-${key}`}>
                    {macro.label} (g)
                  </label>
                  <input
                    id={`budget-${key}`}
                    className="t-input max-w-[7rem]"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    value={grams[key] ?? ''}
                    onChange={(event) => setGrams({ ...grams, [key]: event.target.value })}
                  />
                </div>
              )
            })}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="t-btn t-btn-primary"
                disabled={busy || !gramsDirty}
                onClick={() => void saveGrams()}
              >
                Save
              </button>
              <button type="button" className="t-btn" disabled={busy} onClick={() => void backToAuto()}>
                Back to automatic
              </button>
              <SaveMarks dirty={gramsDirty} saved={saved} />
            </div>
          </>
        )}
      </div>

      {notes.map((note) => (
        <p key={note} className="t-note mb-3">
          {note}
        </p>
      ))}

      <div className="t-card mb-3">
        <Fold label="More targets">
          {CEILINGS.map((row) => (
            <div key={row.key} className="t-row min-h-9 text-sm">
              <span className="flex-1 text-muted">{row.label}</span>
              <span className="t-nums">
                {targets.budget[row.key]} {row.unit}
              </span>
            </div>
          ))}
          <p className="t-note mt-3">
            These follow the Dietary Guidelines and the American Heart Association.{' '}
            <button type="button" className="text-accent" onClick={onOpenGuide}>
              More in the Guide.
            </button>
          </p>
        </Fold>
      </div>
    </>
  )
}
