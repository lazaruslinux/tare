// The words the three Targets screens share, and the two conversions they do.
//
// Kept out of the screens themselves because the list, the Weight goal screen
// and the Activity Levels screen all name the same four levels and the same three
// goals, and one of them drifting would be a screen disagreeing with a screen.

import type { ActivityLevel, Goal, Units, RateOption } from '../api'
import { kgToLb } from './units'

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
  // The steps are quarter pounds, stored as exact kilograms.
  const lb = Math.round(kgToLb(kg) * 4) / 4
  const amount =
    units === 'imperial' ? `${lb} ${lb === 1 ? 'lb' : 'lbs'}` : `${Math.round(kg * 100) / 100} kg`
  return `${goal === 'gain' ? 'Gain' : 'Lose'} ${amount} per week`
}

// The three fastest steps ask the member to say they have read the review.
export const ACKNOWLEDGE_FROM = 2
export const READ_THE_REVIEW =
  'Check this box to indicate that you have read the goal rate review above.'

// What the review note says about each step. His words, one for the first
// step, one for the second, and one shared by the three fastest.
const LOSE_REVIEW = [
  'This rate is often easier to maintain over time. Many people find it supports ' +
    'consistency and nourishment, without needing to push or restrict further.',
  'This creates a larger difference between energy intake and expenditure. While it ' +
    'may work for some, many find it harder to maintain over time. Pay attention to ' +
    'recovery and overall well-being.',
  'This creates a very large gap between intake and expenditure. At this level, many ' +
    'people notice lower energy, increased hunger, or difficulty recovering from ' +
    'activities. Choosing a slower rate is an option some people find more achievable ' +
    'over longer periods.',
]
const GAIN_REVIEW = ['Slow and steady gains more muscle.', 'Faster. More of the gain is fat.']

export const rateReview = (index: number, goal: Goal): string => {
  const list = goal === 'gain' ? GAIN_REVIEW : LOSE_REVIEW
  return list[Math.min(Math.max(index, 0), list.length - 1)]
}

// What one step costs, in the member's day: its budget and the gap, or where
// the cap or the floor stopped the gap short of what the step asked for.
export const rateCostText = (option: RateOption, goal: Goal): string => {
  const way = goal === 'gain' ? 'over' : 'under'
  if (option.notes.includes('floor')) {
    return (
      `Asks for ${calText(option.asked)} cal a day ${way} what you use. Tare holds your ` +
      `budget at the ${calText(option.calories)} cal floor.`
    )
  }
  if (option.notes.includes('cap')) {
    return (
      `Asks for ${calText(option.asked)} cal a day ${way} what you use. Tare holds it at ` +
      `${calText(option.change)}, a fifth of what you use.`
    )
  }
  return `Budget ${calText(option.calories)} cal: ${calText(option.change)} cal a day ${way} what you use.`
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
  'Tare uses math to make estimates, and does not provide medical advice. Talk to ' +
  'your doctor/clinician before changing how you eat, especially if pregnant, ' +
  'breastfeeding, under care for a medical condition, or have a history of eating ' +
  'disorders.'

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
// Calories are read whole, however they were worked out.
export const calText = (value: number): string => Math.round(value).toLocaleString()
