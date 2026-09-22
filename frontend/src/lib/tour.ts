// The welcome tour as data. The steps are a list rather than a component each,
// so the order and the words are read in one place and the layer that draws
// them knows nothing about what it is pointing at.

import type { DashboardCard, DashboardCardKey } from '../api'
import { showsCard } from './dashboardCards'

export type TourStep = {
  id: string
  title: string
  body: string
  // Which data-tour anchor to cut out, per layout. Absent = centred card.
  target?: { phone?: string; wide?: string }
  // What the shell must show first.
  go?: 'dashboard' | 'journal' | 'food' | 'more'
  // Which Dashboard card this step is about. A step pointing at a card the
  // member has hidden is not walked and is not counted either.
  needs?: DashboardCardKey
}

export const TOUR: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Tare',
    body: 'Two minutes to see where things are. Skip any time; the tour is always under More, then Guide.',
  },
  {
    id: 'today',
    title: 'Today at a glance',
    body: "Calories left, exercise minutes, and steps once a phone is synced. Tap a card's title to open it.",
    target: { phone: 'dash-today', wide: 'dash-today' },
    go: 'dashboard',
    needs: 'numbers',
  },
  {
    id: 'calendar',
    title: 'Your calendar',
    body: "Today's appointments show here against the clock. The whole month is under Calendar, where you can share one with a friend.",
    target: { phone: 'dash-calendar', wide: 'dash-calendar' },
    go: 'dashboard',
    needs: 'calendar',
  },
  {
    id: 'plus',
    title: 'Add anything here',
    body: 'Scan a barcode, add food to the Journal, weigh in, log exercise, or add an appointment.',
    target: { phone: 'tab-plus', wide: 'rail-plus' },
  },
  {
    id: 'journal',
    title: 'Your day, meal by meal',
    body: 'Everything you eat lands here. Complete marks the day done, and Targets is one tap away.',
    target: { phone: 'journal-top', wide: 'journal-top' },
    go: 'journal',
  },
  {
    id: 'food',
    title: 'Find food',
    body: 'Search the Tare database and your own foods. A barcode Tare does not know is looked up on Open Food Facts, and you check the details before submitting the food.',
    target: { phone: 'food-search', wide: 'food-search' },
    go: 'food',
  },
  {
    id: 'targets',
    title: 'Targets',
    body: 'Your calorie budget, weight goal and activity level live here.',
    // The rail lists Targets where the phone list does, so both layouts go to
    // More and the screen behind the card is the same one.
    target: { phone: 'more-targets', wide: 'rail-targets' },
    go: 'more',
  },
  {
    id: 'sync',
    title: 'Import your workouts & metrics',
    body: 'Sync your phone and every workout arrives with its route, splits and heart rate, and your steps adjust your budget.',
    target: { phone: 'more-sync', wide: 'more-sync' },
    go: 'more',
  },
  {
    id: 'friends',
    title: 'Friends',
    body: 'Add friends under Members. Only friends see what you choose under Sharing.',
    target: { phone: 'more-members', wide: 'more-members' },
    go: 'more',
  },
  {
    id: 'done',
    title: "That's the tour",
    body: 'Take it again any time under More, then Guide.',
  },
]

// The tour as one account reads it, which is the list the count is taken from.
export const tourSteps = (cards: DashboardCard[]): TourStep[] =>
  TOUR.filter((step) => step.needs === undefined || showsCard(cards, step.needs))
