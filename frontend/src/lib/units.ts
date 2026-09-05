// The mirror of the backend's app/units.py, and it has to stay one.
//
// A food is measured in one of two families: mass, whose base unit is the gram,
// and volume, whose base unit is the millilitre. Its nutrition is stored per 100
// of that base. Measuring it in the other family needs a density, which a label
// only sometimes gives, and water is what is assumed when it did not. The
// screens say so out loud whenever that assumption is the one being used.

export type BaseUnit = 'g' | 'ml'
export type Unit = 'g' | 'oz' | 'lb' | 'ml' | 'floz' | 'cup' | 'tbsp' | 'tsp' | 'l' | 'gal'

export const MASS_UNITS: Unit[] = ['g', 'oz', 'lb']
export const VOLUME_UNITS: Unit[] = ['ml', 'floz', 'cup', 'tbsp', 'tsp', 'l', 'gal']

// How many base units one of each unit is.
export const UNIT_TO_BASE: Record<Unit, number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
  ml: 1,
  floz: 29.5735,
  cup: 236.588,
  tbsp: 14.7868,
  tsp: 4.92892,
  l: 1000,
  gal: 3785.41,
}

export const UNIT_LABEL: Record<Unit, string> = {
  g: 'g',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  floz: 'fl oz',
  cup: 'cup',
  tbsp: 'tbsp',
  tsp: 'tsp',
  l: 'liter',
  gal: 'gal',
}

// Both families, always. Any food may be measured out in either one, which is
// the whole reason a density exists.
export const UNIT_GROUPS: { label: string; units: Unit[] }[] = [
  { label: 'Weight', units: MASS_UNITS },
  { label: 'Volume', units: VOLUME_UNITS },
]

// What a millilitre weighs when the label never said.
export const WATER_DENSITY = 1

// Said whenever that fallback is what produced a number on screen.
export const WATER_HINT = 'Assumes a water-like density (1 ml weighs 1 g).'

// A food carrying only what a conversion needs, so this works on a whole food
// and on anything else that knows how it is measured.
type Measured = { base_unit: BaseUnit; density_g_per_ml?: number | null }

export const baseUnitOf = (unit: Unit): BaseUnit =>
  VOLUME_UNITS.includes(unit) ? 'ml' : 'g'

// Whether measuring this food in this unit leaves its own family, which is what
// decides whether a density was involved at all.
export const crossesFamily = (food: Measured, unit: Unit): boolean =>
  baseUnitOf(unit) !== food.base_unit

// `amount` of `unit` in the food's own base unit. The same arithmetic the
// server does, so a number previewed here and a number stored there agree.
export function toBase(food: Measured, amount: number, unit: Unit): number {
  const baseAmount = amount * UNIT_TO_BASE[unit]
  if (!crossesFamily(food, unit)) return baseAmount
  const density = food.density_g_per_ml || WATER_DENSITY
  return food.base_unit === 'g' ? baseAmount * density : baseAmount / density
}

// What somebody chose to measure with: a unit, or one of the food's own named
// servings, which is already an amount of the base unit and converts to nothing.
export type Pick = { kind: 'unit'; unit: Unit } | { kind: 'serving'; index: number }

export function pickToBase(
  food: Measured,
  servings: { base_amount: number }[],
  amount: number,
  pick: Pick
): number {
  return pick.kind === 'serving'
    ? amount * (servings[pick.index]?.base_amount ?? 0)
    : toBase(food, amount, pick.unit)
}

// A per-100 figure at some other amount of the base unit. Null stays null: a
// nutrient the label never gave is not zero of it.
export const scale = (per100: number | null, baseAmount: number): number | null =>
  per100 === null ? null : (per100 * baseAmount) / 100

// The other way: a figure read off a label for one serving of this many base
// units, as the per-100 the food is stored as. The backend needs no such
// helper, because nothing per a serving ever reaches it.
export const toPer100 = (value: number | null, baseAmount: number): number | null =>
  value === null || baseAmount <= 0 ? null : (value * 100) / baseAmount

export const round1 = (value: number): number => Math.round(value * 10) / 10

// How a logged portion reads back: the words somebody chose to measure with,
// not the base amount it came to. A quick add has no portion at all.
export function portionText(portion: {
  amount: number | null
  unit: string | null
  serving_label: string | null
}): string {
  const { amount, unit, serving_label: label } = portion
  if (amount === null || unit === null) return ''
  if (label !== null) return amount === 1 ? label : `${round1(amount)} × ${label}`
  return `${round1(amount)} ${UNIT_LABEL[unit as Unit] ?? unit}`
}

// How a recipe entry reads back. It is counted in servings of itself, which is
// the one portion that is not measured in anything.
export const servingsText = (amount: number): string =>
  `${round1(amount)} ${amount === 1 ? 'serving' : 'servings'}`

// ---- The body's own measurements, which are not a food's.
//
// A food is measured in grams or millilitres. A person is measured in
// kilograms and centimetres on the server, whatever they read in, and these
// are the constants that carry one to the other. They are the doc's, and the
// backend's app/health.py holds the same two figures.

export const KG_PER_LB = 0.45359237
export const CM_PER_INCH = 2.54
export const INCHES_PER_FOOT = 12

export const lbToKg = (lb: number): number => lb * KG_PER_LB
export const kgToLb = (kg: number): number => kg / KG_PER_LB
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH

// A height in centimetres as feet and whole inches. Twelve inches rounds up to
// the next foot rather than reading as "5 ft 12 in".
export function heightParts(cm: number): { feet: number; inches: number } {
  const total = Math.round(cm / CM_PER_INCH)
  return { feet: Math.floor(total / INCHES_PER_FOOT), inches: total % INCHES_PER_FOOT }
}

export const partsToCm = (feet: number, inches: number): number =>
  inchesToCm(feet * INCHES_PER_FOOT + inches)

// What a weight is entered and shown in, by what the account reads in.
export const weightUnit = (units: 'imperial' | 'metric'): string =>
  units === 'imperial' ? 'lb' : 'kg'

export const weightIn = (kg: number, units: 'imperial' | 'metric'): number =>
  round1(units === 'imperial' ? kgToLb(kg) : kg)

export const weightFrom = (value: number, units: 'imperial' | 'metric'): number =>
  units === 'imperial' ? lbToKg(value) : value

export const weightText = (kg: number, units: 'imperial' | 'metric'): string =>
  `${weightIn(kg, units)} ${weightUnit(units)}`

export function heightText(cm: number, units: 'imperial' | 'metric'): string {
  if (units === 'metric') return `${Math.round(cm)} cm`
  const { feet, inches } = heightParts(cm)
  return `${feet} ft ${inches} in`
}

// Distances. Everything the server stores is in metres, and everything on
// screen is in whichever unit the member reads in.
export const M_PER_MILE = 1609.344

export const distanceUnit = (units: 'imperial' | 'metric'): string =>
  units === 'metric' ? 'km' : 'mi'

export const distanceIn = (metres: number, units: 'imperial' | 'metric'): number =>
  units === 'metric' ? metres / 1000 : metres / M_PER_MILE

export const distanceText = (metres: number, units: 'imperial' | 'metric'): string =>
  `${round1(distanceIn(metres, units)).toLocaleString()} ${distanceUnit(units)}`

// How long a session ran, in the shortest words that are still exact.
export function durationText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  if (hours === 0) return `${minutes} min`
  return `${hours} h ${minutes} min`
}

// Minutes per mile or per kilometre, written the way a pace is read.
export function paceText(
  metres: number,
  seconds: number,
  units: 'imperial' | 'metric'
): string | null {
  const covered = distanceIn(metres, units)
  if (covered <= 0 || seconds <= 0) return null
  const perUnit = seconds / 60 / covered
  const minutes = Math.floor(perUnit)
  const rest = Math.round((perUnit - minutes) * 60)
  const carried = rest === 60 ? { minutes: minutes + 1, rest: 0 } : { minutes, rest }
  return `${carried.minutes}:${String(carried.rest).padStart(2, '0')} /${distanceUnit(units)}`
}

// The feed's tighter spellings. A row is one line of small text, so a distance
// and a duration there drop the spaces and keep a fixed shape.
export const distanceCompact = (metres: number, units: 'imperial' | 'metric'): string =>
  `${distanceIn(metres, units).toFixed(2)}${distanceUnit(units)}`

export const weightCompact = (kg: number, units: 'imperial' | 'metric'): string =>
  `${weightIn(kg, units)}${weightUnit(units)}`

// A clock reading of a finished session: 01:19:02, hours always written.
export function hmsText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`
}

// A running count, which starts short and only grows an hours part when it
// earns one: 7:04, then 1:07:04.
export function elapsedText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const pad = (value: number): string => String(value).padStart(2, '0')
  if (hours === 0) return `${minutes}:${pad(whole % 60)}`
  return `${hours}:${pad(minutes)}:${pad(whole % 60)}`
}
