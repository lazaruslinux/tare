// The words the three Targets screens share, and the two conversions they do.
//
// Kept out of the screens themselves because the list, the Weight goal screen
// and the Activity Levels screen all name the same four levels and the same three
// goals, and one of them drifting would be a screen disagreeing with a screen.

import type { ActivityLevel, Goal, Units } from '../api'
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

export const GOAL_LABEL: Record<Goal, string> = {
  maintain: 'Maintain',
  lose: 'Lose weight',
  gain: 'Gain weight',
}

// A goal rate in whichever units the account reads in. The server keeps
// kilograms a week, and the words say which way it is going.
export const rateStepText = (kg: number, units: Units, goal: Goal): string => {
  const amount = units === 'imperial' ? `${round1(kgToLb(kg))} lb` : `${kg} kg`
  return `${amount} ${goal === 'gain' ? 'gained' : 'lost'} / week`
}

// Where the 1 percent of body weight a week guidance starts to bite.
const FAST_SHARE = 0.01

// What the review note says about the goal rate that is set. The words are
// the doc's decision 13, and the tier is picked from the rate against the
// weight it is a share of.
export const rateReview = (
  kg: number,
  latestKg: number | null,
  goal: Goal
): string => {
  if (goal === 'gain') return 'Slow and steady gains more muscle.'
  if (kg <= 0.45) {
    return 'Most sustainable. Keeps the most muscle.'
  }
  if (latestKg !== null && kg > latestKg * FAST_SHARE) {
    return (
      'Aggressive. Over 1 percent of your weight a week: much of it is water, and ' +
      'muscle goes with it. Most guidance stops at 2 lb.'
    )
  }
  return 'Achievable, with a bigger daily gap. Ease back if it stops feeling right.'
}

// What the four details a personal number needs are still waiting on, and
// where the member is sent to hand it over. The server works out the list.
export type PersonalGap = { label: string; needs: 'weight' | 'profile' }

export const personalNumber = (missing: string[]): PersonalGap => {
  if (missing.includes('weight')) {
    return { label: 'Add a weigh-in for a personal number', needs: 'weight' }
  }
  if (missing.includes('sex') || missing.includes('height')) {
    return { label: 'Add your height and gender for a personal number', needs: 'profile' }
  }
  return { label: 'Add your birthdate for a personal number', needs: 'profile' }
}

// Decision 30, word for word, said once and then reachable from the Guide.
export const DISCLAIMER =
  'Tare estimates. It is not medical advice. The numbers come from population ' +
  'averages and can be off by a few hundred calories for any one person. Talk to ' +
  'a clinician before changing how you eat if you are pregnant or breastfeeding, ' +
  'under care for a medical condition, or have a history of disordered eating.'

// Decision 18's second sentence, which always travels with the month.
export const PACE_CAVEAT =
  'Estimate. Updates with each weigh-in.'

// The one paragraph on the Weight goal screen that is not about a number on it.
export const GOOD_TO_KNOW =
  'Your budget is re-figured from every weigh-in. After a month, Tare may suggest a ' +
  'small correction.'

// Which sentences belong on which screen. The server sends them with their
// keys so neither screen has to read the sentences to place them.
export const PACE_NOTES = ['cap', 'floor', 'pregnancy']
export const SPLIT_NOTES = ['carbs_low', 'manual', 'defaults']

export const notesFor = (
  keys: string[],
  notes: string[],
  wanted: string[]
): string[] => notes.filter((_, index) => wanted.includes(keys[index] ?? ''))

// A month and never a day (decision 18).
export const dateText = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

// A typed field as a number, or null for one left empty.
export const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

// A calorie figure the way every screen says it: grouped, and never "kcal".
export const calText = (value: number): string => value.toLocaleString()
