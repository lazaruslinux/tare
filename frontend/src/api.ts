// The one way anything here talks to the backend. Every call goes through it,
// so the session cookie, the JSON headers, and the shape of a failure are
// decided once instead of at each call site.

import type { Slot } from './lib/day'
import type { BaseUnit, Unit } from './lib/units'

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
// Which way the two weights point. Worked out on the server from the latest
// weigh-in and the goal weight, and never stored or chosen.
export type Goal = 'maintain' | 'lose' | 'gain'
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
  // Kilograms a week. Null is the first step for the direction rather than no
  // goal rate at all, and the steps are the ones this direction offers.
  rate_kg_per_week: number | null
  rate_steps: number[]
  goal_weight_kg: number | null
  // What a day of movement aims at. Both always carry a number: a ring with no
  // goal has nothing to fill.
  exercise_minutes_goal: number
  step_goal: number
  // Whether sex, height, weight and age are all there. Without all four the
  // published general targets stand.
  complete: boolean
  // Which of the four are still missing, so a screen can name the gap rather
  // than work the rule out again. Empty once the profile is complete.
  missing: string[]
  latest_weight_kg: number | null
  latest_weight_date: string | null
  // Worked out on the server from the latest weight and the height, to one
  // decimal. Null until both are there, and never carrying a category word.
  bmi: number | null
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

// How the three are set: worked out, by percentages, or in grams.
export type TargetMode = 'auto' | 'pct' | 'grams'

export type Split = { protein_pct: number; carbs_pct: number; fat_pct: number }

// One level of everyday movement, and what picking it would do to a day. Null
// without a profile: no number is better than a made-up one.
export type ActivityOption = {
  level: ActivityLevel
  adds: number | null
  total: number | null
}

// The facts behind the resting figure, said back on the Activity Levels
// screen. Body fat is the reading really used, and null when it was not.
export type RestingInputs = {
  age: number
  sex: Sex
  height_cm: number
  weight_kg: number
  body_fat_pct: number | null
}

// Where the budget came from, in three figures. The adjustment is signed.
export type Breakdown = { use: number; adjustment: number; budget: number }

export type Targets = {
  mode: TargetMode
  complete: boolean
  budget: BudgetFigures
  // What was typed by hand, kept even while the automatic numbers are in use.
  manual: BudgetFigures | null
  // What share of the day each of the three is.
  percentages: Split
  // The guide's starting points, and the one line the losing split adds.
  presets: Record<Goal, Split>
  preset_notes: Partial<Record<Goal, string>>
  // What the body uses at rest, and whether a recent body fat reading is what
  // that figure was worked out from.
  resting: number | null
  uses_body_fat: boolean
  // What the resting figure was worked out from, unrounded and in the
  // server's own units. Null while the profile is incomplete.
  resting_inputs: RestingInputs | null
  activity_options: ActivityOption[]
  // Null when there is nothing to work out: no profile, or a typed-in budget.
  breakdown: Breakdown | null
  exercise_today: number
  activity_level: ActivityLevel
  goal: Goal
  // Kilograms a week, and the steps the stepper moves between.
  rate_kg_per_week: number | null
  rate_steps: number[]
  goal_weight_kg: number | null
  exercise_minutes_goal: number
  step_goal: number
  weekly_rate: number
  // Plain sentences from the server. Screens print them as they stand, and
  // the keys beside them say which screen each one belongs on.
  notes: string[]
  note_keys: string[]
  nudges: Nudge[]
  // A month and never a day.
  projection: { date: string } | null
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
  // Muscle and bone are shares of the weight; the masses beside them are
  // worked out from that day's weight for showing.
  muscle_pct: number | null
  bone_pct: number | null
  muscle_kg: number | null
  bone_kg: number | null
  visceral_fat: number | null
  lean_kg: number | null
  source: string
}

// The newest reading of one number and the day it was taken.
export type Stamp = { value: number; date: string; mass_kg?: number | null }

export type Latest = {
  weight_kg: Stamp | null
  body_fat_pct: Stamp | null
  body_water_pct: Stamp | null
  muscle_pct: Stamp | null
  bone_pct: Stamp | null
  visceral_fat: Stamp | null
}

export type TrendPoint = { date: string; kg: number }

export type Measurements = {
  days: number
  latest: Latest
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

// Where a food stands with the shared database, from where this account is
// standing: never offered, waiting, shared because this account offered it, or
// turned down.
export type Community = 'none' | 'pending' | 'approved' | 'rejected'

// A food as a list reads it: enough to pick it out and nothing else.
export type FoodRow = {
  id: number
  name: string
  brand: string
  calories: number | null
  base_unit: BaseUnit
  status: string
  community: Community
  // What the label calls one of them, so a row can read per the serving
  // somebody eats. Null on a food nobody has named a serving for.
  serving: LabelServing | null
  // The picture the shared database publishes for it, when it has one. Null is
  // a food nobody has photographed, not a picture that failed to load.
  photo_url: string | null
}

// A row in one of the member's own lists. The day it was last eaten is what
// those lists are ordered by, so the thing somebody had yesterday is near the
// top of a list of hundreds. Null is a food nobody has logged.
export type MyFoodRow = FoodRow & { last_logged: string | null }

// One page of the shared database. The marker is opaque: it says where the
// page stopped and nothing else, and it is only ever handed back as it came.
export type BrowsePage = { items: FoodRow[]; next_cursor: string | null }

// A serving as it was typed and as it is counted: "1 block", one pound, and
// the 453.592 g every sum underneath it is worked out from.
export type LabelServing = {
  name: string
  amount: number
  unit: Unit
  base_amount: number
}

export type FoodServing = LabelServing & {
  id: number
  position: number
}

// One request about one food, as the food's own page lists it: what was asked,
// what came of it, and when.
export type FoodSubmissionRow = {
  id: number
  kind: string
  status: string
  created_at: string
  decision_note: string
}

// The whole food. Every nutrient is per 100 of base_unit, and null is what a
// label never said rather than none of it.
export type Food = FoodRow & {
  density_g_per_ml: number | null
  // The code on the packet, where there was one. A food with one is held to
  // both photographs when it is offered to everybody.
  barcode: string | null
  ingredients_text: string
  // Whether this account is the one that may change it.
  mine: boolean
  // Whether this account keeps it to hand.
  pinned: boolean
  // Why an administrator turned this account's own offer of it down. Empty
  // unless that is what happened to it.
  decision_note: string
  // What this account has asked about this food of theirs, newest first.
  // Empty for a food that is not yours.
  submissions: FoodSubmissionRow[]
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
  serving: LabelServing | null
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
  // The food this row opens: the one that was offered, or the shared one a
  // correction or a picture is about. Null once it is gone.
  food_id: number | null
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
  servings: (LabelServing & { position: number })[]
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
  // The nutrition panel it was read off, for checking the numbers against.
  // Only the queue asks for this, and only an administrator is served it.
  label_photo_url: string | null
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
  last_logged: string | null
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
// last_logged is always null on a meal: logging one writes an ordinary entry
// per food in it and leaves nothing saying the meal was the reason.
export type MealRow = { id: number; name: string; items: number; last_logged: string | null }

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

// The five figures a day's budget is made of, for the fold that shows them.
// The adjustment is signed, and the level is the key its name is looked up by.
export type DayEnergy = {
  resting: number
  activity: number
  level: ActivityLevel
  exercise: number
  adjustment: number
  budget: number
}

// One day in a run of them: what was consumed against what was budgeted.
// A day nobody logged is nothing consumed rather than a day with no answer.
export type DayRow = {
  date: string
  calories: number
  budget: number
  exercise_kcal: number
  logged: boolean
}

// A run of days ending today, oldest first.
export type DiaryDays = { days: DayRow[] }

export type DiaryDay = {
  date: string
  totals: Totals
  slots: Record<Slot, { entries: DiaryEntry[]; subtotal_calories: number | null }>
  // The four the day is read against, what exercise added back to it, and what
  // is left. All four arrive with the day so the Journal reads it in one call.
  budget: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  exercise_kcal: number
  // What was worked today, against what a day aims at.
  exercise_minutes: number
  exercise_minutes_goal: number
  remaining_calories: number
  // Where the day's own number came from. Null while the budget is typed in by
  // hand or the profile is short of a detail.
  energy: DayEnergy | null
  // What a phone counted. Not sent yet: the ring it fills appears with device
  // sync, and until then the day carries no steps at all.
  steps?: number | null
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
// What a picture is for. A front photo is the pack on a shelf and one per food
// is published; a label photo is the nutrition panel, offered as evidence for a
// request, and nobody but its uploader and an administrator is ever served one.
export type PhotoPurpose = 'front' | 'label'

export async function upload<T>(
  path: string,
  file: File,
  purpose: PhotoPurpose = 'front'
): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
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
