// The words the three Targets screens share, and the two conversions they do.
//
// Kept out of the screens themselves because the list, the Weight goal screen
// and the Energy screen all name the same four levels and the same three
// goals, and one of them drifting would be a screen disagreeing with a screen.

import type { ActivityLevel, Goal, Rate, Units } from '../api'
import { kgToLb, round1 } from './units'

// Decision 5's four levels. The names are the member's; the multipliers they
// come from are never said (decision 29).
export const LEVELS: {
  value: ActivityLevel
  label: string
  note: string
  example: string
}[] = [
  {
    value: 'not_much',
    label: 'Sedentary',
    note: 'Desk work, little walking',
    example: 'A desk job, driving, most evenings sitting',
  },
  {
    value: 'light',
    label: 'Lightly Active',
    note: 'On your feet part of the day',
    example: 'Light chores, a short walk, standing for part of a shift',
  },
  {
    value: 'moderate',
    label: 'Moderately Active',
    note: 'A physical job, or on your feet most of the day',
    example: 'Waiting tables, nursing, a day of house work',
  },
  {
    value: 'heavy',
    label: 'Very Active',
    note: 'Hard physical work all day',
    example: 'Construction, farm work, carrying loads all day',
  },
]

export const LEVEL_LABEL: Record<ActivityLevel, string> = {
  not_much: 'Sedentary',
  light: 'Lightly Active',
  moderate: 'Moderately Active',
  heavy: 'Very Active',
}

// What the chooser says before the four cards, so nobody counts a workout
// twice by picking the level their gym days feel like.
export const LEVEL_INTRO =
  'This is the kind of job and ordinary day you have. Do not count exercise: ' +
  'what you log is added on top.'

export const GOALS: { value: Goal; label: string }[] = [
  { value: 'maintain', label: 'Maintain' },
  { value: 'lose', label: 'Lose weight' },
  { value: 'gain', label: 'Gain weight' },
]

export const GOAL_LABEL: Record<Goal, string> = {
  maintain: 'Maintain',
  lose: 'Lose weight',
  gain: 'Gain weight',
}

// The paces, and what each of them is a week.
export const RATE_KG: Record<Rate, number> = {
  gentle: 0.25,
  steady: 0.5,
  faster: 0.75,
  fastest: 1,
}

export const RATE_LABEL: Record<Rate, string> = {
  gentle: 'Gentle',
  steady: 'Steady',
  faster: 'Faster',
  fastest: 'Fastest',
}

// A pace in whichever units the account reads in. The server keeps kilograms.
export const rateText = (rate: Rate, units: Units): string =>
  units === 'imperial'
    ? `${round1(kgToLb(RATE_KG[rate]))} lb a week`
    : `${RATE_KG[rate]} kg a week`

// Decision 30, word for word, said once and then reachable from the Guide.
export const DISCLAIMER =
  'tare estimates. It is not medical advice. The numbers come from population ' +
  'averages and can be off by a few hundred calories for any one person. Talk to ' +
  'a clinician before changing how you eat if you are pregnant or breastfeeding, ' +
  'under care for a medical condition, or have a history of disordered eating.'

// Decision 18's second sentence, which always travels with the month.
export const PACE_CAVEAT =
  'Bodies adapt, so the real date is usually later. The estimate updates as you weigh in.'

// The one paragraph on the Weight goal screen that is not about a number on it.
export const GOOD_TO_KNOW =
  'As your weight changes, so does what you use in a day. tare re-figures your ' +
  'budget from each weigh-in and, after a month of weigh-ins, may offer a small ' +
  'correction.'

// Which sentences belong on which screen. The server sends them with their
// keys so neither screen has to read the sentences to place them.
export const PACE_NOTES = ['cap', 'floor', 'gate', 'pregnancy']
export const SPLIT_NOTES = ['carbs_low', 'manual', 'defaults']

export const notesFor = (
  keys: string[],
  notes: string[],
  wanted: string[]
): string[] => notes.filter((_, index) => wanted.includes(keys[index] ?? ''))

// A month and never a day (decision 18).
export const monthText = (iso: string): string =>
  new Date(`${iso}-01T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })

// A typed field as a number, or null for one left empty.
export const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

// A calorie figure the way every screen says it: grouped, and never "kcal".
export const calText = (value: number): string => value.toLocaleString()
