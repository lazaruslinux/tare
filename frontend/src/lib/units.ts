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
  l: 'litre',
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

export const round1 = (value: number): number => Math.round(value * 10) / 10
