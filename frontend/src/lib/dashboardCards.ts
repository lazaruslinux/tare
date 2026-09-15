// What the Dashboard's cards are called and what each of them holds, in one
// place: the screen that arranges them and the screen that draws them read the
// same list, so a card cannot be named one thing here and another there.

import type { DashboardCard, DashboardCardKey } from '../api'

export const DASHBOARD_CARDS: { key: DashboardCardKey; label: string; note: string }[] = [
  { key: 'numbers', label: "Today's numbers", note: 'Rings and macro bars' },
  { key: 'calendar', label: 'Today', note: 'Your calendar for the day' },
  { key: 'food_activity', label: 'Food & Activity', note: 'Side by side on a wide window' },
  { key: 'progress', label: 'Progress', note: 'Weight and body readings' },
  {
    key: 'community',
    label: 'Community',
    note: 'Phone only; a wide window keeps it in the right column',
  },
]

// Tare's own order, everything shown. What a member reads until they arrange it.
export const DASHBOARD_DEFAULT: DashboardCard[] = DASHBOARD_CARDS.map((card) => ({
  key: card.key,
  shown: true,
}))

// Two lists that say the same thing. Saving is skipped when they do.
export const sameOrder = (a: DashboardCard[], b: DashboardCard[]): boolean =>
  a.length === b.length &&
  a.every((card, index) => card.key === b[index].key && card.shown === b[index].shown)

// Whether a list is the one nobody has touched, which is what greys the reset.
export const isDefaultOrder = (cards: DashboardCard[]): boolean =>
  sameOrder(cards, DASHBOARD_DEFAULT)

// Whether the Dashboard draws a card at all. A key nobody saved is shown.
export const showsCard = (cards: DashboardCard[], key: DashboardCardKey): boolean =>
  cards.find((card) => card.key === key)?.shown !== false
