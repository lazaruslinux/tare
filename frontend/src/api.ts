// The one way anything here talks to the backend. Every call goes through it,
// so the session cookie, the JSON headers, and the shape of a failure are
// decided once instead of at each call site.

import type { Slot } from './lib/day'
import type { BaseUnit } from './lib/units'

export type Units = 'imperial' | 'metric'

// The four numbers a food is read by. The other six are on the label or they
// are not, and nothing outside the label itself carries them.
export type Headline = 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'

export type Me = {
  id: number
  username: string
  display_name: string | null
  email: string | null
  email_verified: boolean
  is_admin: boolean
  units: Units
  timezone: string
}

// A food as a list reads it: enough to pick it out and nothing else.
export type FoodRow = {
  id: number
  name: string
  brand: string
  calories: number | null
  base_unit: BaseUnit
  status: string
}

export type FoodServing = {
  id: number
  name: string
  base_amount: number
  position: number
}

// The whole food. Every nutrient is per 100 of base_unit, and null is what a
// label never said rather than none of it.
export type Food = FoodRow & {
  density_g_per_ml: number | null
  ingredients_text: string
  // Whether this account is the one that may change it.
  mine: boolean
  // Whether this account keeps it to hand.
  pinned: boolean
  servings: FoodServing[]
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  saturated_fat_g: number | null
  trans_fat_g: number | null
  cholesterol_mg: number | null
  sodium_mg: number | null
  fiber_g: number | null
  sugar_g: number | null
}

// A food offered before anybody searches: kept on purpose, or eaten lately.
export type RepeatRow = FoodRow & { pinned: boolean }

// One thing eaten. The numbers are for the amount served, not per 100 of
// anything, and they were worked out when it was logged. food_id is null once
// the food it came from is gone, and the row still reads.
export type DiaryEntry = {
  id: number
  name: string
  brand: string
  amount: number | null
  unit: string | null
  serving_label: string | null
  food_id: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

// Null is a nutrient no entry on the day carried, which is not none of it.
export type Totals = Record<string, number | null>

export type DiaryDay = {
  date: string
  totals: Totals
  slots: Record<Slot, { entries: DiaryEntry[]; subtotal_calories: number | null }>
}

// Every refusal from the API is a status and one sentence, so that is what a
// failed call throws. Screens print the sentence as it stands rather than
// writing their own words for someone else's rule.
export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export function errorText(failure: unknown): string {
  return failure instanceof ApiError ? failure.detail : 'Something went wrong. Try again.'
}

type Options = { method?: string; body?: unknown }

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { method = 'GET', body } = options
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      // Named rather than assumed. The session lives in a cookie, and a fetch
      // that quietly drops it reads on screen as being signed out.
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // A network that is not there is not the server's answer, so it does not
    // get a status. Status 0 is what the screens read as "nothing came back".
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }

  if (response.status === 204) return undefined as T

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    // A body that is not JSON says nothing worth keeping; the status below is
    // still the answer.
  }

  if (!response.ok) {
    const detail = (payload as { detail?: unknown } | null)?.detail
    throw new ApiError(
      response.status,
      typeof detail === 'string' ? detail : 'Something went wrong. Try again.'
    )
  }
  return payload as T
}
