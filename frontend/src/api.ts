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
  // Null on an account made before tare asked for one, which is what sends it
  // to the one screen that does.
  birthdate: string | null
  location: string | null
}

export type Sex = 'female' | 'male'
export type ActivityLevel = 'not_much' | 'light' | 'moderate' | 'heavy'
export type Goal = 'maintain' | 'lose' | 'gain'
export type Rate = 'gentle' | 'steady' | 'faster' | 'fastest'
export type EffortLevel = 'light' | 'moderate' | 'vigorous'

// What tare needs to work out somebody's own numbers, and what it has so far.
export type Profile = {
  sex: Sex | null
  height_cm: number | null
  location: string | null
  birthdate: string | null
  pregnant_or_breastfeeding: boolean
  activity_level: ActivityLevel
  goal: Goal
  // Null is the default pace for the goal rather than no pace at all.
  rate: Rate | null
  goal_weight_kg: number | null
  // Whether sex, height, weight and age are all there. Without all four the
  // published general targets stand.
  complete: boolean
  latest_weight_kg: number | null
  latest_weight_date: string | null
}

// A day's targets: the four anybody reads, and the five to stay inside.
export type BudgetFigures = {
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  fiber_g: number
  saturated_fat_g_max: number
  sugar_g_max: number
  sodium_mg_max: number
  cholesterol_mg_max: number
}

// A calm sentence the Targets page shows until it is waved away.
export type Nudge = { key: string; text: string }

export type Targets = {
  mode: 'auto' | 'manual'
  complete: boolean
  budget: BudgetFigures
  // What was typed by hand, kept even while the automatic numbers are in use.
  manual: BudgetFigures | null
  activity_level: ActivityLevel
  goal: Goal
  rate: Rate | null
  rates_offered: Rate[]
  goal_weight_kg: number | null
  weekly_rate: number
  // Plain sentences from the server. Screens print them as they stand.
  notes: string[]
  nudges: Nudge[]
  // A month and never a day.
  projection: { month: string } | null
  trend_kg: number | null
  reestimate: { delta_calories: number; calories: number } | null
  disclaimer_seen: boolean
}

// One day's reading. Null is a thing that was not measured, not none of it.
export type Measurement = {
  date: string
  weight_kg: number
  body_fat_pct: number | null
  body_water_pct: number | null
  muscle_kg: number | null
  bone_kg: number | null
  visceral_fat: number | null
  lean_kg: number | null
  source: string
}

export type TrendPoint = { date: string; kg: number }

export type Measurements = {
  days: number
  measurements: Measurement[]
  trend: TrendPoint[]
}

// One workout somebody typed in. estimated is set only on the answer to
// logging it, and says the credit was worked out at an assumed weight.
export type Exercise = {
  id: number
  date: string
  activity: string
  name: string
  effort: EffortLevel
  minutes: number
  kcal: number
  estimated?: boolean
}

// One row of the catalogue. An activity offers only the efforts it has a
// published value for.
export type Activity = {
  key: string
  name: string
  efforts: { effort: EffortLevel; met: number }[]
}

// A food as a list reads it: enough to pick it out and nothing else.
export type FoodRow = {
  id: number
  name: string
  brand: string
  calories: number | null
  base_unit: BaseUnit
  status: string
  // The picture the shared database publishes for it, when it has one. Null is
  // a food nobody has photographed, not a picture that failed to load.
  photo_url: string | null
}

// One page of the shared database. The marker is opaque: it says where the
// page stopped and nothing else, and it is only ever handed back as it came.
export type BrowsePage = { items: FoodRow[]; next_cursor: string | null }

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

// The panel every food shape carries, per 100 of its base unit. Null is what a
// label never said rather than none of it.
export type Panel = {
  calories: number | null
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

// What a barcode lookup came back with. Not a food: it has no id, because there
// is nothing here to log or to pin until somebody has checked it and sent it.
export type Prefill = Panel & {
  barcode: string | null
  name: string
  brand: string
  base_unit: BaseUnit
  density_g_per_ml: number | null
  ingredients_text: string
  // Where the reading came from, in the words a person reads.
  source: string
  serving: { name: string; base_amount: number } | null
}

// The four answers a scan gets, and the four things the app does with them.
export type Scanned =
  | { state: 'approved'; food: Food }
  | { state: 'mine'; food: Food }
  | { state: 'prefill'; prefill: Prefill }
  | { state: 'blank'; barcode: string }

// One thing this account offered to the shared database, and what came of it.
export type MySubmission = {
  id: number
  kind: string
  status: 'pending' | 'approved' | 'rejected'
  // Null once the food it was about has been deleted.
  name: string | null
  // What a correction or a picture was about. Null for a new food.
  target_name: string | null
  note: string
  decision_note: string
  decided_at: string | null
  created_at: string
}

// A food as it is being offered, with nothing in it about who is reading.
export type Proposed = Panel & {
  id: number
  name: string
  brand: string
  barcode: string | null
  base_unit: BaseUnit
  density_g_per_ml: number | null
  ingredients_text: string
  servings: { name: string; base_amount: number }[]
}

// The shared food a request is about, named well enough to recognise.
export type QueueTarget = { id: number; name: string; brand: string }

export type QueueItem = {
  id: number
  kind: string
  note: string
  created_at: string
  submitted_by: string | null
  // The picture being offered. Null unless one came with the request.
  photo_url: string | null
  // The food being proposed. Null on a picture, which proposes no food.
  food: Proposed | null
  // What a correction or a picture is about, and what it would replace.
  target: QueueTarget | null
  current: Proposed | null
  current_photo_url: string | null
}

// One invite link, as the screen that hands them out reads it. The path is
// joined to this browser's own origin: the server does not know what somebody
// typed to reach it.
export type AdminInvite = {
  code: string
  path: string
  created_at: string
  expires_at: string | null
  // Null while it is still a way in; a name once somebody came through it.
  used_by: string | null
}

export type AdminUser = {
  id: number
  username: string
  display_name: string | null
  is_admin: boolean
  email_verified: boolean
  created_at: string
  submissions: { pending: number; approved: number; rejected: number }
}

// One thing inside a recipe or a kept meal: which food it was, and how much of
// it. food_id is null once that food is gone, and the name stays.
export type Part = {
  id: number
  food_id: number | null
  name: string
  brand: string
  amount: number
  unit: string
  serving_label: string | null
}

// An ingredient also carries what that much of the food came to, worked out
// when the recipe was saved.
export type RecipeIngredient = Part & Panel

// A recipe as a list reads it: what one serving of it is worth.
export type RecipeRow = {
  id: number
  name: string
  yield_servings: number
  per_serving: Record<Headline, number | null>
}

// The whole recipe. The totals are for all of it and the per-serving figures
// are those shared out by what it makes.
export type Recipe = {
  id: number
  name: string
  yield_servings: number
  ingredients: RecipeIngredient[]
  totals: Panel
  per_serving: Panel
}

// A kept meal as a list reads it, by how much is in it.
export type MealRow = { id: number; name: string; items: number }

// The whole meal. It has no numbers of its own: each item takes them from the
// food as it stands when the meal is logged.
export type Meal = { id: number; name: string; items: Part[] }

// What logging a whole meal came to, and the names of anything left out
// because the food behind it is gone.
export type MealLogged = { entries: DiaryEntry[]; skipped: string[] }

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
  // Set instead of food_id when what was eaten was a recipe, in which case the
  // amount is a number of its servings.
  recipe_id: number | null
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
  // The four the day is read against, what exercise added back to it, and what
  // is left. All four arrive with the day so the Journal reads it in one call.
  budget: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  exercise_kcal: number
  remaining_calories: number
  measurement: Measurement | null
  exercise: Exercise[]
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
  return send<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// The photo upload, which is the one call that does not send JSON. The browser
// writes the multipart boundary itself, so no Content-Type is set here: setting
// one by hand omits the boundary and the body arrives unreadable.
export async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  return send<T>(path, { method: 'POST', body: form })
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // Named rather than assumed. The session lives in a cookie, and a fetch
      // that quietly drops it reads on screen as being signed out.
      credentials: 'include',
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
