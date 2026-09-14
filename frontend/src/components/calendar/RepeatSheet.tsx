import { useState, type ReactNode } from 'react'

import type { RepeatIn, RepeatOut } from '../../api'
import { Sheet } from '../Sheet'

// How often an appointment comes round, asked the way a desktop calendar asks
// it: the pattern on top, the range it runs for underneath.
//
// Daily is a weekly pattern with all seven days, which is how the server
// stores one, and a count end is walked out into a date there, so it only ever
// lives in this draft.

export type Pattern = 'daily' | 'weekly' | 'monthly' | 'yearly'
type EndMode = 'never' | 'until' | 'count'

export type RepeatDraft = {
  pattern: Pattern
  // Weekday numbers with Monday nought, the way the server counts them.
  days: number[]
  interval: number
  monthDay: number
  anchor: string
  endMode: EndMode
  until: string
  count: number
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAYS = [0, 1, 2, 3, 4]

// The toggles read Sunday first, the way the month grid does, while the value
// under each stays the server's own numbering.
const DAY_TOGGLES: { value: number; letter: string; name: string }[] = [
  { value: 6, letter: 'S', name: 'Sunday' },
  { value: 0, letter: 'M', name: 'Monday' },
  { value: 1, letter: 'T', name: 'Tuesday' },
  { value: 2, letter: 'W', name: 'Wednesday' },
  { value: 3, letter: 'T', name: 'Thursday' },
  { value: 4, letter: 'F', name: 'Friday' },
  { value: 5, letter: 'S', name: 'Saturday' },
]

const SHORT_DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const PATTERNS: { value: Pattern; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

// What "every N" counts in, per pattern.
const UNIT: Record<Pattern, string> = {
  daily: 'weeks',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
}

// The ceilings the server keeps: a year of weeks, two years of months, a
// decade of years.
const INTERVAL_CAP: Record<Pattern, number> = { daily: 1, weekly: 52, monthly: 24, yearly: 10 }

function ordinal(value: number): string {
  const tail = ['th', 'st', 'nd', 'rd']
  const teen = value % 100
  return `${value}${tail[(teen - 20) % 10] ?? tail[teen] ?? tail[0]}`
}

// A bare date read as UTC, the way the rest of the app reads a day with no
// time in it, so it is never pushed onto its neighbour.
function dayText(iso: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    ...options,
  })
}

const compact = (iso: string): string => dayText(iso, { month: 'short', day: 'numeric' })

// What the form row reads: "Every week on Mon, Wed until Dec 31".
export function repeatSummary(draft: RepeatDraft): string {
  const every = draft.interval > 1 ? `Every ${draft.interval} ${UNIT[draft.pattern]}` : ''
  let base: string
  if (draft.pattern === 'daily') {
    base = 'Every day'
  } else if (draft.pattern === 'monthly') {
    base = `${every || 'Every month'} on the ${ordinal(draft.monthDay)}`
  } else if (draft.pattern === 'yearly') {
    const on = draft.anchor === '' ? '' : ` on ${compact(draft.anchor)}`
    base = `${every || 'Every year'}${on}`
  } else {
    const on =
      draft.days.length === 0
        ? 'no days yet'
        : [...draft.days]
            .sort((one, two) => one - two)
            .map((day) => SHORT_DAY[day])
            .join(', ')
    base = `${every || 'Every week'} on ${on}`
  }
  if (draft.endMode === 'until' && draft.until !== '') return `${base} until ${compact(draft.until)}`
  if (draft.endMode === 'count') return `${base}, ${draft.count} times`
  return base
}

export function repeatReady(draft: RepeatDraft): boolean {
  if (draft.anchor === '') return false
  if (draft.pattern === 'weekly' && draft.days.length === 0) return false
  if (draft.pattern === 'monthly' && (draft.monthDay < 1 || draft.monthDay > 31)) return false
  if (draft.interval < 1 || draft.interval > INTERVAL_CAP[draft.pattern]) return false
  if (draft.endMode === 'until') return draft.until !== '' && draft.until >= draft.anchor
  if (draft.endMode === 'count') return draft.count >= 1 && draft.count <= 500
  return true
}

export function repeatPayload(draft: RepeatDraft): RepeatIn {
  const shared = {
    // Every N only means something once there is a gap to count: daily is
    // every day by definition.
    interval: draft.pattern === 'daily' ? 1 : draft.interval,
    anchor: draft.anchor === '' ? null : draft.anchor,
    until: draft.endMode === 'until' && draft.until !== '' ? draft.until : null,
    count: draft.endMode === 'count' ? draft.count : null,
  }
  if (draft.pattern === 'monthly') return { type: 'monthly', month_day: draft.monthDay, ...shared }
  if (draft.pattern === 'yearly') return { type: 'yearly', ...shared }
  return { type: 'weekly', days: draft.pattern === 'daily' ? EVERY_DAY : draft.days, ...shared }
}

// A stored pattern read back into the draft. All seven days is only Daily at
// every-week spacing: a week-on week-off pattern carries all seven as well,
// and reading that as Daily would flatten it the next time it was saved.
export function draftOf(repeat: RepeatOut | null, startsOn: string): RepeatDraft {
  if (repeat === null) {
    return {
      pattern: 'weekly',
      days: [],
      interval: 1,
      monthDay: Number(startsOn.slice(8, 10)) || 1,
      anchor: startsOn,
      endMode: 'never',
      until: '',
      count: 10,
    }
  }
  return {
    pattern:
      repeat.type === 'monthly'
        ? 'monthly'
        : repeat.type === 'yearly'
          ? 'yearly'
          : repeat.days.length === 7 && repeat.interval === 1
            ? 'daily'
            : 'weekly',
    days: repeat.days,
    interval: repeat.interval,
    monthDay: repeat.month_day ?? (Number(startsOn.slice(8, 10)) || 1),
    anchor: repeat.anchor ?? startsOn,
    endMode: repeat.until === null ? 'never' : 'until',
    until: repeat.until ?? '',
    count: 10,
  }
}

// The one pattern somebody starting from "Does not repeat" most likely means.
export function startingDraft(startsOn: string, weekdayNumber: number): RepeatDraft {
  return { ...draftOf(null, startsOn), days: [weekdayNumber] }
}

function Radio({
  name,
  label,
  chosen,
  onPick,
  children,
}: {
  name: string
  label: string
  chosen: boolean
  onPick: () => void
  children?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3">
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input
          type="radio"
          name={name}
          className="h-4 w-4 accent-[var(--accent)]"
          checked={chosen}
          onChange={onPick}
        />
        {label}
      </label>
      {chosen && children !== undefined && <div className="pb-3">{children}</div>}
    </div>
  )
}

export function RepeatSheet({
  open,
  draft,
  onCancel,
  onSave,
  onStop,
}: {
  open: boolean
  draft: RepeatDraft
  onCancel: () => void
  onSave: (next: RepeatDraft) => void
  // Back to an appointment that happens once. Absent while the appointment
  // does not repeat yet, where there is nothing to stop.
  onStop?: () => void
}) {
  // A copy, so backing out leaves the pattern the appointment already has.
  const [held, setHeld] = useState(draft)
  const set = <Key extends keyof RepeatDraft>(key: Key, value: RepeatDraft[Key]) =>
    setHeld((was) => ({ ...was, [key]: value }))

  const toggleDay = (day: number) =>
    setHeld((was) => ({
      ...was,
      days: was.days.includes(day)
        ? was.days.filter((one) => one !== day)
        : [...was.days, day].sort((one, two) => one - two),
    }))

  return (
    <Sheet open={open} label="How often" tall onClose={onCancel}>
      <p className="mb-3 text-base font-semibold">How often</p>

      <p className="t-label">Pattern</p>
      <div className="mb-3 flex flex-wrap gap-2">
        {PATTERNS.map((one) => (
          <button
            key={one.value}
            type="button"
            aria-pressed={held.pattern === one.value}
            className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => set('pattern', one.value)}
          >
            {one.label}
          </button>
        ))}
      </div>

      {held.pattern !== 'daily' && (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          Every
          <input
            className="t-input t-nums w-20"
            type="number"
            inputMode="numeric"
            min={1}
            max={INTERVAL_CAP[held.pattern]}
            value={held.interval}
            onChange={(event) => set('interval', Math.max(1, Number(event.target.value) || 1))}
          />
          {UNIT[held.pattern]}
        </label>
      )}

      {held.pattern === 'weekly' && (
        <div className="mb-3">
          <p className="t-label">On these days</p>
          <div className="flex gap-1">
            {DAY_TOGGLES.map((day) => (
              <button
                key={day.value}
                type="button"
                aria-pressed={held.days.includes(day.value)}
                aria-label={day.name}
                className="min-h-11 flex-1 rounded-lg border border-line bg-surface-2 text-xs font-semibold text-muted aria-pressed:border-accent aria-pressed:text-accent"
                onClick={() => toggleDay(day.value)}
              >
                {day.letter}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="t-textlink"
            onClick={() => set('days', WEEKDAYS)}
          >
            Weekdays only
          </button>
          {held.days.length === 0 && <p className="t-error">Pick at least one day.</p>}
        </div>
      )}

      {held.pattern === 'monthly' && (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          On day
          <input
            className="t-input t-nums w-20"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            value={held.monthDay}
            onChange={(event) =>
              set('monthDay', Math.min(31, Math.max(1, Number(event.target.value) || 1)))
            }
          />
          of the month
        </label>
      )}

      {held.pattern === 'yearly' && (
        <p className="t-note mb-3">
          The day and month come from the date it starts on.
        </p>
      )}

      <div className="border-t border-line pt-3">
        <p className="t-label">How long it runs</p>
        <div className="mb-1">
          <label className="t-label" htmlFor="repeat-anchor">
            Starts
          </label>
          <input
            id="repeat-anchor"
            className="t-input"
            type="date"
            value={held.anchor}
            onChange={(event) => set('anchor', event.target.value)}
          />
        </div>
        <p className="t-note mb-3">The day the pattern counts from.</p>

        <div className="flex flex-col gap-2">
          <Radio
            name="repeat-end"
            label="No end date"
            chosen={held.endMode === 'never'}
            onPick={() => set('endMode', 'never')}
          />
          <Radio
            name="repeat-end"
            label="End by"
            chosen={held.endMode === 'until'}
            onPick={() => set('endMode', 'until')}
          >
            <input
              className="t-input"
              type="date"
              aria-label="Last day"
              value={held.until}
              onChange={(event) => set('until', event.target.value)}
            />
            {held.until !== '' && held.until < held.anchor && (
              <p className="t-error mt-1">The last day is before the pattern starts.</p>
            )}
          </Radio>
          <Radio
            name="repeat-end"
            label="End after"
            chosen={held.endMode === 'count'}
            onPick={() => set('endMode', 'count')}
          >
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                className="t-input t-nums w-20"
                type="number"
                inputMode="numeric"
                min={1}
                max={500}
                value={held.count}
                onChange={(event) =>
                  set('count', Math.min(500, Math.max(1, Number(event.target.value) || 1)))
                }
              />
              times
            </label>
          </Radio>
        </div>
      </div>

      <div className="t-actions mt-4">
        <button
          type="button"
          className="t-btn t-btn-primary flex-1"
          disabled={!repeatReady(held)}
          onClick={() => onSave(held)}
        >
          Save pattern
        </button>
        <button type="button" className="t-btn" onClick={onCancel}>
          Back
        </button>
      </div>
      {onStop !== undefined && (
        <button type="button" className="t-btn mt-2 w-full" onClick={onStop}>
          Stop repeating
        </button>
      )}
    </Sheet>
  )
}
