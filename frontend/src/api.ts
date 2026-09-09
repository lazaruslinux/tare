// The one way anything here talks to the backend. Every call goes through it,
// so the session cookie, the JSON headers, and the shape of a failure are
// decided once instead of at each call site.

import type { Clock } from './lib/clock'
import type { Slot } from './lib/day'
import type { Micros } from './lib/micros'
import type { BaseUnit, Unit } from './lib/units'

export type Units = 'imperial' | 'metric'

// The four numbers a food is read by. The other six are on the label or they
// are not, and nothing outside the label itself carries them.
export type Headline = 'calories' | 'protein_g' | 'carbs_g' | 'fat_g'

// What an account is, wherever its name is shown. Null is a member, which is
// most people. Administrators and reviewers both wear the shield; which of the
// two it is only ever changes the words beside it.
export type Role = 'admin' | 'reviewer' | null

export type Me = {
  id: number
  username: string
  display_name: string | null
  email: string | null
  email_verified: boolean
  // The address a change is waiting on, or null. Set while the link sent to
  // the new address is unopened; the old one is still the account's until then.
  pending_email: string | null
  is_admin: boolean
  role: Role
  // How many of this account's offers the Tare database took, and whether that
  // is enough for them to apply to review.
  approved_count: number
  reviewer_eligible: boolean
  // Whether they have applied and nobody has answered yet.
  reviewer_requested: boolean
  units: Units
  timezone: string
  // Which clock this account reads times on.
  clock: Clock
  // Null on an account made before tare asked for one, which is what sends it
  // to the one screen that does.
  birthdate: string | null
  // Whether the questions asked on the way in are still to be answered. The
  // server's fact, so meeting the verify screen first does not cost somebody
  // the first-run screen.
  first_run_pending: boolean
  // Whether the welcome tour is still to be walked, read the same way.
  tour_pending: boolean
  location: string | null
  // The picture other members see beside this account's name, or null for its
  // initial.
  avatar_url: string | null
  // What this account holds back on a workout other members can see, and the
  // three facts it lets them see about the person.
  feed_hidden: string[]
  share_age: boolean
  share_sex: boolean
  share_location: boolean
  share_workouts: boolean
  // Whether finishing a day says so in the community feed.
  share_journal: boolean
  // Whether a weigh-in that came in lower says how much came off.
  share_weight_loss: boolean
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

export type RateOption = {
  rate_kg_per_week: number
  calories: number
  asked: number
  change: number
  // The day this step reaches the goal on, so the forecast can follow the
  // stepper. Null when there is no trend or the goal is below the range.
  projection: { date: string } | null
  notes: string[]
}

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
  // Every step worked out as if chosen: its budget, what it asked for, what it
  // really takes off, and the notes (cap, floor) that held it there.
  rate_options: RateOption[]
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

// One day's reading. Null is a thing that was not measured, not none of it,
// and the weight is one of those: a day can hold a body fat without one.
export type Measurement = {
  date: string
  weight_kg: number | null
  body_fat_pct: number | null
  body_water_pct: number | null
  // Muscle and bone are shares of the weight; the masses beside them are
  // worked out from that day's weight for showing.
  muscle_pct: number | null
  bone_pct: number | null
  muscle_kg: number | null
  bone_kg: number | null
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
}

export type TrendPoint = { date: string; kg: number }
export type SharePoint = { date: string; pct: number }

// The short name each share is lined under, which the chart's lines and chips
// are keyed on.
export type ShareKey = 'fat' | 'water' | 'muscle'

export type Measurements = {
  days: number
  latest: Latest
  measurements: Measurement[]
  trend: TrendPoint[]
  // The shares laid out the same way, so every line carries its gaps.
  trends: Record<ShareKey, SharePoint[]>
}

// One workout somebody typed in. estimated is set only on the answer to
// logging it, and says the credit was worked out at an assumed weight.
export type Exercise = {
  // Null on a row that arrived from a phone: there is nothing to delete, and
  // the workout it came from is what carries an id.
  id: number | null
  workout_id: number | null
  date: string
  activity: string
  name: string
  effort: EffortLevel | null
  minutes: number
  kcal: number | null
  estimated?: boolean
  source: WorkoutSource
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

// A food as a list reads it: enough to pick it out and nothing else. A search
// answers with a member's own recipes and meals in this same shape, which is
// what kind says: a food carries a brand and a serving and those do not.
export type FoodRow = {
  kind: 'food' | 'recipe' | 'meal'
  id: number
  name: string
  brand: string
  // What it is in a few words: "King Size", "Blueberry flavor". Empty on most
  // foods, which is a food whose name already says everything.
  description: string
  // The aisle it is browsed under, as a slug. Every food carries one; only a
  // shared food is browsed by it.
  section: string
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
  // The same picture at the size a row draws it. Null where none has been
  // written, and a row falls back to the full one.
  thumb_url: string | null
}

// A row of somebody's own list. The list is ordered by when each was added,
// which the screen never has to read, so a row is a food row and nothing more.
export type MyFoodRow = FoodRow

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
  // Null until a reviewer answers.
  decided_at: string | null
  decision_note: string
  // Whether the reviewer changed anything before saying yes, and what they
  // changed, in the words it is read in.
  edited: boolean
  changes: string[]
  // Null while the answer is still news to whoever asked.
  seen_at: string | null
}

// The whole food. Every nutrient is per 100 of base_unit, and null is what a
// label never said rather than none of it.
export type Food = FoodRow & {
  density_g_per_ml: number | null
  // The label on file, sent to an administrator and nobody else.
  label_photo_url?: string | null
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
  // Who offered it to the shared database. Null for a private food.
  submitted_by: string | null
  // And their account, so the name opens their member page.
  submitted_by_id: number | null
  submitted_by_role: Role
  // When the row last moved. Sent back with an edit, so one written against an
  // older copy is refused rather than applied over somebody else's.
  updated_at: string
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
  // How much of the sugars above was put in. Null on every food nobody has
  // read that line off, which is most of them.
  added_sugars_g: number | null
  // The vitamins and minerals on file, per 100 of the base unit, holding only
  // the keys something stated. The screen scales them to the portion it shows
  // and never draws the per-100 figure itself.
  micros: Micros
}

// A food offered before anybody searches: favorited on purpose, or eaten
// lately. The day it was last eaten is null on one nobody has logged.
export type RepeatRow = FoodRow & { pinned: boolean; last_logged: string | null }

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
  added_sugars_g: number | null
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
  // Per 100 of the base unit, the way it is stored. Shown only scaled to the
  // serving the form is filled in per, never as it arrives.
  micros: Micros
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
  // Whether the reviewer changed anything before saying yes, and what.
  edited: boolean
  changes: string[]
  // Null while the answer is still news, which is what the badge counts.
  seen_at: string | null
  decided_at: string | null
  created_at: string
}

// A food as it is being offered, with nothing in it about who is reading.
export type Proposed = Panel & {
  id: number
  name: string
  brand: string
  description: string
  section: string
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
  submitted_by_id: number | null
  // Whether the reader is the one who asked. A reviewer does not decide their
  // own, so the row is greyed rather than opened.
  mine: boolean
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
  // How many people it lets in, and how many of those have come in. A link is
  // still a way in while used is under seats.
  seats: number
  used: number
  // Who came in through it, oldest account first. Empty while nobody has.
  members: string[]
  // Who minted it, and whether that is the reader.
  inviter: string
  mine: boolean
}

export type AdminUser = {
  id: number
  username: string
  display_name: string | null
  is_admin: boolean
  role: Role
  // Whether they have applied to review and nobody has answered yet, and when
  // they asked. Null once somebody has answered, either way.
  requested: boolean
  requested_at: string | null
  email: string | null
  email_verified: boolean
  created_at: string
  submissions: { pending: number; approved: number; rejected: number }
}

// One page of the account list, newest first. The marker is the id of the last
// row handed over, and is only ever handed back as it came.
export type AdminUserPage = { items: AdminUser[]; next_cursor: string | null }

// Which slice of the account list is wanted, where a screen wants one.
export type UserFilter = 'reviewer' | 'admin' | 'requested'

// One line of the record: who did what, to what, and when. The names are
// copies taken as it happened, so a renamed account or a deleted food still
// reads the way it read then.
export type ReviewLogRow = {
  id: number
  when: string
  actor_name: string
  action: string
  target_kind: string
  target_id: number | null
  target_name: string
  // Whatever the action is worth saying more about: the reason for a no, the
  // parts of a panel a correction moved.
  detail: string[] | string | null
}

export type ReviewLogPage = { items: ReviewLogRow[]; next_cursor: string | null }

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
  // Read off the live food rather than the copy this row keeps, so the row
  // draws what a food row draws. All three are empty once that food is gone.
  thumb_url: string | null
  description: string
  status: string
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
} & Pictured

// The picture of the finished dish, where whoever made it took one. Null is
// nobody having photographed it, not a picture that failed to load.
export type Pictured = {
  photo_url: string | null
  // The same picture at the size a row draws it.
  thumb_url: string | null
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
} & Weighed &
  Pictured

// What something made of parts weighs. weight_g is what the parts come to,
// null the moment one of them cannot be weighed, and those are named in
// unweighed. final_weight_g is what the scale said when it was done, which
// beats the sum whenever somebody typed one.
export type Weighed = {
  weight_g: number | null
  unweighed: string[]
  final_weight_g: number | null
}

// A kept meal as a list reads it: how much is in it, and what all of it comes
// to.
export type MealRow = {
  id: number
  name: string
  items: number
  totals: Panel
  last_logged: string | null
} & Pictured

// One thing in a kept meal, with what that much of its food comes to. The four
// are null once the food is gone, which is what the row itself says too.
export type MealItem = Part & Record<Headline, number | null>

// The whole meal. It keeps no numbers of its own: every figure here is worked
// out from the foods as they stand now.
export type Meal = {
  id: number
  name: string
  items: MealItem[]
  totals: Panel
} & Weighed &
  Pictured

// What logging a whole meal came to: one line, and the names of anything left
// out because the food behind it is gone.
export type MealLogged = { entry: DiaryEntry; skipped: string[] }

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
  // Or a kept meal, counted the same way: in servings of the whole meal.
  meal_id: number | null
  // Which standing auto-log wrote this row. Null on one somebody logged.
  auto_log_id: number | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

// A food, a recipe or a kept meal set to log itself into the same meal every
// day. The unit is the portion as the diary takes it: a measure, or
// "serving:<id>" for one of the food's own, with the serving's name beside it
// for the row to read. A recipe or a meal counts in servings or weighs in
// grams, and has no serving to name.
export type AutoLog = {
  id: number
  kind: 'food' | 'recipe' | 'meal'
  food_id: number | null
  recipe_id: number | null
  meal_id: number | null
  name: string
  brand: string
  // The small picture of the food or of the finished dish, where there is one.
  thumb_url: string | null
  amount: number
  unit: string
  serving_label: string | null
  slot: Slot
  started_on: string
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
  // The three the day was made of, summed the same way and read whole.
  protein_g: number
  carbs_g: number
  fat_g: number
  budget: number
  exercise_kcal: number
  // What a phone counted, or null on a day no phone sent.
  steps: number | null
  logged: boolean
  // Whether the member marked the day complete, which is also what locks it.
  completed: boolean
}

// A run of days ending today, oldest first.
export type DiaryDays = { days: DayRow[] }

export type DiaryDay = {
  date: string
  // A day the member has closed. Nothing on it can be written until it is
  // opened again.
  completed: boolean
  completed_at: string | null
  totals: Totals
  // What the day came to of each vitamin and mineral, in catalogue order and
  // holding only the keys something carried. Worked out at every read rather
  // than kept, so a food filled in later fills in the days it was eaten on.
  micros: Micros
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
  // What a phone counted. Null on a day no phone sent, which is what keeps the
  // ring off a day that has no answer.
  steps: number | null
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

// The event a refused write raises, listened for by the screen it was about.
export const STALE = 'tare:stale'

export function errorText(failure: unknown): string {
  return failure instanceof ApiError ? failure.detail : 'Something went wrong. Try again.'
}

// A query string out of whatever is actually set. An empty value is left off
// rather than sent blank, and everything that goes is encoded.
export function queryString(parts: Record<string, string | number | undefined>): string {
  const set: string[] = []
  for (const [key, value] of Object.entries(parts)) {
    if (value === undefined || value === '') continue
    set.push(`${key}=${encodeURIComponent(value)}`)
  }
  return set.length === 0 ? '' : `?${set.join('&')}`
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
// A dish photo is what somebody cooked, on a recipe or a kept meal of their
// own, and nobody but them is ever served one.
export type PhotoPurpose = 'front' | 'label' | 'dish'

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

// A picture on a food itself, which is how an administrator keeps a shared row
// right: an id puts one on, null takes the standing one off. The queue has its
// own pair of these, because a request's pictures belong to the request.
export function foodPhoto(
  foodId: number,
  purpose: PhotoPurpose,
  photoId: number | null
): Promise<unknown> {
  return photoId === null
    ? api(`/foods/${foodId}/photo?purpose=${purpose}`, { method: 'DELETE' })
    : api(`/foods/${foodId}/photo`, { method: 'POST', body: { photo_id: photoId, purpose } })
}

// The picture of the finished dish on a recipe or a kept meal: an id puts one
// on, null takes the standing one off. Both go, file and all.
export function dishPhoto(
  kind: 'recipe' | 'meal',
  id: number,
  photoId: number | null
): Promise<unknown> {
  const path = `/${kind === 'recipe' ? 'recipes' : 'meals'}/${id}/photo`
  return photoId === null
    ? api(path, { method: 'DELETE' })
    : api(path, { method: 'POST', body: { photo_id: photoId } })
}

// A file and nothing else, which is what the health export upload sends.
export async function uploadFile<T>(path: string, file: File): Promise<T> {
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
    // A write refused because the day was closed somewhere else. Said once,
    // here, so the screen showing that day reads it again rather than every
    // sheet having to be told what to do about it.
    if (response.status === 409) window.dispatchEvent(new Event(STALE))
    throw new ApiError(
      response.status,
      typeof detail === 'string' ? detail : 'Something went wrong. Try again.'
    )
  }
  return payload as T
}


// Where a workout came from. Only a manual entry can be deleted in Tare.
export type WorkoutSource = 'manual' | 'apple' | 'hc' | 'upload'

// The same thing in the words somebody would use for what is on their wrist,
// rather than the name of a data format. Manual rows say nothing: a row
// somebody typed does not need telling where it came from.
export const SOURCE_LABEL: Record<string, string> = {
  apple: 'Apple Watch',
  hc: 'Health Connect',
  upload: 'From a file',
}

// The four readings the Fitness screen draws, by the keys the API answers in.
export type FitnessMetric = 'steps' | 'active_kcal' | 'exercise_minutes' | 'resting_hr'

// The four the hour bars are drawn from.
export type HourMetric = 'steps' | 'active_kcal' | 'distance' | 'hr'

export type FitnessTiles = Record<FitnessMetric, number | null>

export type FitnessWeekDay = FitnessTiles & { date: string }

export type Workout = {
  id: number
  activity: string
  date: string
  started_at: string
  duration_s: number
  kcal: number | null
  distance_m: number | null
  avg_hr: number | null
  max_hr: number | null
  elevation_gain_m: number | null
  indoor: boolean
  source: WorkoutSource
  // Whether the owner keeps this one out of the community feed.
  hidden_from_feed: boolean
  // What looked odd about it, by key. Empty on almost every workout.
  flags: string[]
}

// One minute of a session. Every reading is optional: the arrays a phone sends
// start and stop at their own moments.
export type WorkoutSample = {
  minute: number
  distance_m: number | null
  hr_min: number | null
  hr_avg: number | null
  hr_max: number | null
  kcal: number | null
  steps: number | null
}

// One whole mile or kilometre of a session, worked out on the server in the
// units whoever is reading reads in.
export type WorkoutSplit = {
  // 1 for the first, 2 for the second, and so on.
  index: number
  // How far this one covered. A full unit for every split but the last.
  distance_m: number
  // Unrounded, so the splits of a session still add up to the session.
  seconds: number
  // How long it took per mile or kilometre, which is what the bars are scaled
  // on: fewer seconds is quicker.
  pace_s_per_unit: number
  // The average of whatever heart rate readings landed inside it, or null.
  hr: number | null
  // Whether it is a whole one. The last split of a session usually is not.
  whole: boolean
}

// One session read whole. Every field the owner may hold back is optional
// here: another member is served the workout without them, key and all, so
// absent is what hidden looks like and null stays what was never measured.
export type WorkoutDetail = Omit<Workout, 'elevation_gain_m' | 'flags'> & {
  user_id: number
  display_name: string
  mine: boolean
  // The two things that can be absent on somebody else's workout: what Tare
  // made of the numbers is the owner's alone, and the route takes the climb
  // with it when it is held back.
  elevation_gain_m?: number | null
  flags?: string[]
  samples: WorkoutSample[]
  // The line, with both its ends already thrown away, or null for a session
  // that recorded no route.
  route?: [number, number][] | null
  splits: WorkoutSplit[]
  // Which split was quickest, by its index, or null where no whole one stands
  // out.
  fastest: number | null
}

// One workout as the community feed lists it: that somebody synced a session,
// and when. No figure from it is on the row, and the workout itself answers
// what was shared.
export type FeedWorkout = {
  kind: 'workout'
  id: number
  user_id: number
  display_name: string
  role: Role
  mine: boolean
  // Whether there is anything behind the row: your own always, somebody
  // else's only where they opened their workout details.
  open: boolean
  // Only ever on your own rows: a workout you kept out of everybody's feed.
  hidden?: boolean
  activity: string
  date: string
  started_at: string
}

// One finished day. It says that and nothing else: never what was eaten, never
// a number. The pronoun is worked out on the server, so the gender behind it
// never reaches anybody.
export type FeedJournal = {
  kind: 'journal'
  // Whose day and which day, which is all this row is named by.
  id: string
  user_id: number
  display_name: string
  role: Role
  mine: boolean
  hidden?: boolean
  date: string
  at: string
  pronoun: string
}

// One weigh-in that came in under the one before it. How much came off, and
// never either weight it was worked out from.
export type FeedWeight = {
  kind: 'weight'
  id: number
  user_id: number
  display_name: string
  role: Role
  mine: boolean
  hidden?: boolean
  date: string
  at: string
  lost_kg: number
  pronoun: string
}

// One member arriving, dated by the moment they answered the questions on the
// way in. Behind no switch and hideable by nobody: it says they are here,
// which everybody can already see.
export type FeedJoined = {
  kind: 'joined'
  // The member is the row, so their id is what names it.
  id: number
  user_id: number
  display_name: string
  role: Role
  mine: boolean
  date: string
  at: string
}

export type FeedRow = FeedWorkout | FeedJournal | FeedWeight | FeedJoined

// One page of the feed, and how many friends there are to fill it. The marker
// is opaque and only ever handed back.
export type FeedPage = { items: FeedRow[]; friends: number; next_cursor: string | null }

// Where two members stand with each other, said from the reader's side: the
// same pending row is "requested" to whoever asked and "incoming" to whoever
// was asked.
export type Friendship = 'self' | 'none' | 'requested' | 'incoming' | 'friends'

// One member as another member sees them. A fact that is not shared is absent
// rather than null, so there is nothing here to read a withheld answer out of.
export type MemberView = {
  friendship: Friendship
  display_name: string
  role: Role
  member_since: string
  avatar_url: string | null
  // Foods they offered that were taken and are still in the shared database.
  // Shown for everybody: it is work done for the group rather than a fact
  // about the person.
  contributions: number
  age?: number
  sex?: Sex
  location?: string
}

// One member in the list of them. The same few things a profile leads with, so
// a row and the page it opens cannot disagree.
export type MemberRow = {
  id: number
  display_name: string
  role: Role
  avatar_url: string | null
  member_since: string
  contributions: number
  // Only on a roster row: the friends lists are already sorted by side.
  friend?: boolean
}

// One page of the roster. It is ordered by a name rather than by an id, so the
// marker is how far down the list the last page reached.
export type MemberPage = { items: MemberRow[]; next_offset: number | null }

// The three sides of this account's friendships: who it shares with, who has
// asked it, and who it has asked.
export type FriendsPage = {
  friends: MemberRow[]
  incoming: MemberRow[]
  outgoing: MemberRow[]
}

// The few figures the wide layout keeps beside whatever is on screen. The
// waiting count is an administrator's alone.
export type TodayStrip = {
  calories_eaten: number | null
  steps: number | null
  exercise_min: number | null
  latest_weight_kg: number | null
  latest_weight_date: string | null
  contributions: number
  pending: number
}

export type FitnessSummary = {
  date: string
  connected: boolean
  last_sync: string | null
  today: FitnessTiles
  week: FitnessWeekDay[]
  goals: { exercise_minutes: number; steps: number }
  workouts: Workout[]
  // How many sessions the same seven days hold, the member's own count.
  week_workouts: number
}

// One day's goals: the figures in force on it, the usual pair behind them, and
// whether that day was set apart from the usual pair at all.
export type DayGoals = {
  date: string
  steps: number
  exercise_minutes: number
  defaults: { steps: number; exercise_minutes: number }
  overridden: boolean
}

// What a history can be asked for: the four a day's summary carries, and the
// distance walked, which is added up from the hour rows.
export type DailyMetric = FitnessMetric | 'distance'

export type FitnessHistory = {
  metric: DailyMetric
  unit: string
  days: { date: string; value: number | null }[]
}

// One line of the Trends card: the week just gone against the four weeks
// before it. Nothing in a window reads as null rather than as zero, and a
// direction is only said when both windows have an answer.
export type TrendRow = {
  key: 'steps' | 'exercise_minutes' | 'distance' | 'workouts'
  recent: number | null
  prior: number | null
  unit: string
  direction: 'up' | 'down' | 'flat' | null
}

export type FitnessTrends = { rows: TrendRow[] }

// One session as a day's readout names it: enough to say what was done and how
// far, and nothing a whole workout page carries.
export type DayWorkout = {
  id: number
  activity: string
  distance_m: number | null
  duration_s: number
}

// One whole day as the Dashboard's Exercise card reads it. A figure is null on
// a day no phone ever sent it, which is not the same as a day of sitting.
export type FitnessDay = {
  date: string
  steps: number | null
  exercise_minutes: number | null
  active_kcal: number | null
  // What that day itself was aimed at, which is the usual pair unless the day
  // was set apart.
  step_goal: number
  exercise_minutes_goal: number
  workouts: DayWorkout[]
}

// A run of days ending today, oldest first.
export type FitnessDays = { days: FitnessDay[] }

export type FitnessHours = { date: string; metric: HourMetric; hours: (number | null)[] }

export type WorkoutPage = { workouts: Workout[]; cursor: number | null }

// What is said about a sync key, which never includes the key itself except in
// the answer that made it.
export type SyncKey = {
  connected: boolean
  path: string
  rotated_at: string | null
  last_used_at: string | null
  // Whether this instance takes a health export as a file at all, and whether
  // this account has anything that came out of one.
  uploads: boolean
  uploaded: boolean
}

export type MintedKey = SyncKey & { token: string }

// What one export did, and the same four figures whichever way it arrived.
export type Synced = { days: number; workouts: number; flagged: number; skipped: number }

// What a wipe took away.
export type Removed = { removed: number }

// One arrival on the sync record: a phone's post, a file, or a wipe. `days`
// and `workouts` are null on a wipe and on rows written before the split was
// kept, and then `accepted` is all the row can say.
export type Arrival = {
  received_at: string
  kind: 'sync' | 'upload' | 'wipe'
  days: number | null
  workouts: number | null
  accepted: number
  skipped: number
  flagged: number
  error: string | null
}

// What has arrived on this account: the totals off the rows themselves, and
// the recent arrivals off the record.
export type Uploads = {
  days_with_data: number
  workouts: number
  first_day: string | null
  last_day: string | null
  last_received_at: string | null
  recent: Arrival[]
}

// One food waiting on an administrator to say which FoodData Central record it
// is, and the records offered for it.
export type MicroCandidate = {
  fdc_id: number
  description: string
  data_type: string
}

export type MicroMatch = {
  id: number
  food_id: number
  name: string
  brand: string
  label_photo_url: string | null
  candidates: MicroCandidate[]
}

// One file somebody handed this instance, on the administrator's list.
export type Upload = {
  id: number
  username: string
  display_name: string | null
  received_at: string
  bytes: number | null
  accepted: number
  flagged: number
  skipped: number
}
