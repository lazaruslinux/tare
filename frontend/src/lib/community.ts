// What a food has to carry before it can be offered to everybody, and when its
// numbers are worth a second look.
//
// The first rule is the server's, repeated here so the form can say what is
// missing while somebody is still filling it in rather than after they send it.
// The sentences are the server's own, word for word: two wordings for one rule
// is how a client and a server end up disagreeing in front of a person.

import { HEADLINE, MORE_FACTS, type Nutrient } from '../components/NutritionLabel'

// The ten, in the order the server checks them, so the field named on screen
// is the field the server would have named.
export const SHARED_FACTS = [...HEADLINE, ...MORE_FACTS]

// Every retail code printed on food: EAN-8 at the short end, GTIN-14 at the
// long. The same shape the server holds one to, so a frame that decodes to
// something it would refuse is thrown away rather than asked about. It lives
// here rather than beside the decoder because the scanner's own module pulls a
// megabyte of WebAssembly in with it, and this is needed before any of that.
export const BARCODE = /^[0-9]{8,14}$/

export type Values = Record<Nutrient, number | null>

export const needed = (label: string): string =>
  `${label} is needed before this can be shared.`

export const NO_SERVING = 'A serving is needed before this can be shared.'

// What the first empty box is, if there is one. Zero is an answer: a food with
// no fibre in it says nought, and that is a number somebody read off a label.
export function firstMissing(values: Values): Nutrient | null {
  for (const fact of SHARED_FACTS) {
    if (values[fact.key] === null) return fact.key
  }
  return null
}

export function missingSentence(values: Values, servings: number): string | null {
  const missing = firstMissing(values)
  if (missing !== null) {
    return needed(SHARED_FACTS.find((fact) => fact.key === missing)!.label)
  }
  return servings > 0 ? null : NO_SERVING
}

// Said when the panel contradicts itself rather than when it is incomplete.
export const MACRO_WARNING = 'These numbers do not add up; check them against the label.'

// Below this the sum is built out of figures the label rounded, and rounding is
// not a mistake worth telling anybody about.
const FLOOR_MIN = 20
// How far under its own macronutrients a calorie figure may sit before it is
// worth asking about. Roomier than the server's own repair, because this is a
// question put to somebody holding the packet, not a correction made behind
// their back.
const TOLERANCE = 0.75

// The first number worth looking at again, or nothing. A headline box left
// empty is the plainest case; after that it is energy that its own protein,
// sugar and fat cannot account for. Sugars rather than carbohydrate, so a
// sweetener's honest label is not flagged every time.
export function macroDoubt(values: Values): Nutrient | null {
  for (const fact of HEADLINE) {
    if (values[fact.key] === null) return fact.key
  }
  const { calories, protein_g: protein, fat_g: fat, sugar_g: sugar } = values
  if (calories === null || protein === null || fat === null || sugar === null) return null
  const floor = 4 * protein + 4 * sugar + 9 * fat
  return floor >= FLOOR_MIN && calories < TOLERANCE * floor ? 'calories' : null
}
