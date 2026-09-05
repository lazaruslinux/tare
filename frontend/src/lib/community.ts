// What a food has to carry before it can be offered to everybody, and when its
// numbers are worth a second look.
//
// A blank is a number the label did not print, and nothing here asks anybody to
// invent one. What is still asked for is a serving, said in the words of the
// two boxes it is typed in rather than in the rule behind them.

import { HEADLINE, LABEL_ORDER, type Nutrient } from '../components/NutritionLabel'

// The eleven, in the order a label prints them, which is the order the server
// names them in too, so the field named on screen is the field the server
// would have named.
export const SHARED_FACTS = LABEL_ORDER

// Every retail code printed on food: EAN-8 at the short end, GTIN-14 at the
// long. The same shape the server holds one to, so a frame that decodes to
// something it would refuse is thrown away rather than asked about. It lives
// here rather than beside the decoder because the scanner's own module pulls a
// megabyte of WebAssembly in with it, and this is needed before any of that.
export const BARCODE = /^[0-9]{8,14}$/

export type Values = Record<Nutrient, number | null>

// The same ceiling the server holds an upload to, and its sentence. Checked on
// this side so a photo that is never going to be accepted is not sent up a
// phone connection first.
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export const PHOTO_TOO_LARGE = 'A photo must be at most 10 MB.'

// What every screen says when something has gone to the review queue.
export const SENT_FOR_REVIEW = 'Sent for review'

// Said where a serving is entered rather than where it is refused, so it names
// the two boxes instead of the rule behind them.
export const NO_SERVING = 'Give the serving a name and a size.'

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

// Where a request stands, in the words somebody reads rather than the word the
// column stores.
export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
}

// An approval somebody corrected on the way through is its own answer: the
// food is in, and it is not word for word what was offered.
export const EDITED_LABEL = 'Approved with edits'

// A report is answered rather than published, so the same three states read as
// something else: it is looked at, and then the food is either put right or it
// is left as it was.
export const REPORT_STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Resolved',
  rejected: 'Not changed',
}

export const statusLabel = (status: string, edited: boolean, kind?: string): string => {
  if (kind === 'report') return REPORT_STATUS_LABEL[status] ?? status
  return status === 'approved' && edited ? EDITED_LABEL : (STATUS_LABEL[status] ?? status)
}

// What a reviewer changed, as one line under the chip that says they did.
export const changeLine = (changes: string[]): string => `Changed: ${changes.join(', ')}`

// What a submission is called in the queue and in a member's own list.
export const KIND_LABEL: Record<string, string> = {
  new: 'New food',
  edit: 'Edit',
  photo: 'Photo',
  report: 'Report',
}

// Where a food sits in a shop, which is how the shared database is browsed.
// The slugs are what the server stores and the words beside them are what
// every screen says, so this list is the one place either is written down.
export const SECTIONS: { slug: string; label: string }[] = [
  { slug: 'produce', label: 'Produce' },
  { slug: 'meat', label: 'Meat' },
  { slug: 'seafood', label: 'Seafood' },
  { slug: 'eggs-and-dairy', label: 'Eggs and dairy' },
  { slug: 'bread-and-bakery', label: 'Bread and bakery' },
  { slug: 'grains-and-pasta', label: 'Grains and pasta' },
  { slug: 'canned-and-jarred', label: 'Canned and jarred' },
  { slug: 'frozen', label: 'Frozen' },
  { slug: 'snacks', label: 'Snacks' },
  { slug: 'candy-and-sweets', label: 'Candy and sweets' },
  { slug: 'drinks', label: 'Drinks' },
  { slug: 'coffee-and-tea', label: 'Coffee and tea' },
  { slug: 'condiments-and-sauces', label: 'Condiments and sauces' },
  { slug: 'spices-and-baking', label: 'Spices and baking' },
  { slug: 'prepared-meals', label: 'Prepared meals' },
  { slug: 'supplements', label: 'Supplements' },
  { slug: 'other', label: 'Other' },
]

// What a section is called on screen. A slug nothing knows reads as itself
// rather than as a blank, which is a food to go and look at.
export const sectionLabel = (slug: string): string =>
  SECTIONS.find((row) => row.slug === slug)?.label ?? slug

// Said where the section is picked, and it is the server's own sentence.
export const NO_SECTION = 'Pick a section.'
