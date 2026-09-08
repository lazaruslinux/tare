// The pictures the invite page shows, in one place and in this order. `line` is
// the bullet on the invite the picture belongs beside. src is null until a real
// file lands in public/screenshots, and a null one draws a frame saying what
// belongs there rather than an empty box.
export type Shot = {
  id: string
  line: number
  shape: 'phone' | 'desktop'
  caption: string
  src: string | null
}

export const SHOTS: Shot[] = [
  { id: 'setup-about', line: 1, shape: 'phone', caption: 'Setup: About you', src: '/screenshots/setup-about.webp' },
  {
    id: 'setup-activity',
    line: 2,
    shape: 'phone',
    caption: 'Setup: Activity level',
    src: '/screenshots/setup-activity.webp',
  },
  {
    id: 'plan-goal',
    line: 3,
    shape: 'phone',
    caption: 'Weight goal with the rate steps and the review',
    src: '/screenshots/plan-goal.webp',
  },
  {
    id: 'plan-targets',
    line: 3,
    shape: 'desktop',
    caption: 'Targets: goal forecast, energy target and macro targets',
    src: '/screenshots/plan-targets.webp',
  },
  {
    id: 'scan-form',
    line: 4,
    shape: 'phone',
    caption: 'A scanned barcode, prefilled, with ingredients and vitamins',
    src: '/screenshots/scan-form.webp',
  },
  {
    id: 'journal-day',
    line: 4,
    shape: 'desktop',
    caption: 'A journal day with the breakdown open',
    src: '/screenshots/journal-day.webp',
  },
  {
    id: 'recipe-page',
    line: 5,
    shape: 'phone',
    caption: 'A recipe page with photo, parts and Auto-log',
    src: '/screenshots/recipe-page.webp',
  },
  {
    id: 'fitness-workout',
    line: 6,
    shape: 'phone',
    caption: 'A workout: the two-lane chart and the route',
    src: '/screenshots/fitness-workout.webp',
  },
  { id: 'sync-setup', line: 6, shape: 'desktop', caption: 'Health data sync', src: '/screenshots/sync-setup.webp' },
  {
    id: 'feed-desktop',
    line: 7,
    shape: 'desktop',
    caption: 'Dashboard on a desktop with the feed column',
    src: '/screenshots/feed-desktop.webp',
  },
  {
    id: 'member-page',
    line: 7,
    shape: 'phone',
    caption: "A member's page with Contributions",
    src: '/screenshots/member-page.webp',
  },
]
