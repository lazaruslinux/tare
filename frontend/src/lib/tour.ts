// The welcome tour as data. The steps are a list rather than a component each,
// so the order and the words are read in one place and the layer that draws
// them knows nothing about what it is pointing at.

export type TourStep = {
  id: string
  title: string
  body: string
  // Which data-tour anchor to cut out, per layout. Absent = centred card.
  target?: { phone?: string; wide?: string }
  // What the shell must show first.
  go?: 'dashboard' | 'journal' | 'food' | 'more'
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
    body: "Steps, calories left and exercise minutes. Tap a card's title to open it.",
    target: { phone: 'dash-today', wide: 'dash-today' },
    go: 'dashboard',
  },
  {
    id: 'plus',
    title: 'Add anything here',
    body: 'Scan a barcode, add a food, weigh in, or log exercise.',
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
    body: 'Search the Tare database and your own foods. Nothing is looked up online, so scanning a barcode is how a new food gets in.',
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
    title: 'Connect your phone',
    body: 'Set up Health data sync once and steps, workouts and weight flow in on their own.',
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
