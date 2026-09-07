import type { GalleryKey } from './about'

// The pictures the invite and About show, listed in one place. src is null
// until a real file lands in public/screenshots, and a null one draws a frame
// saying what belongs there rather than an empty box.
export type Shot = {
  id: string
  gallery: GalleryKey
  shape: 'phone' | 'desktop'
  caption: string
  src: string | null
}

export const SHOTS: Shot[] = [
  {
    id: 'food-1',
    gallery: 'food',
    shape: 'phone',
    caption: 'A food page with photo, nutrition facts and ingredients',
    src: null,
  },
  {
    id: 'food-2',
    gallery: 'food',
    shape: 'phone',
    caption: 'Browsing the database with search and the letter strip',
    src: null,
  },
  {
    id: 'food-3',
    gallery: 'food',
    shape: 'phone',
    caption: 'A scanned barcode, prefilled and ready to submit',
    src: null,
  },
  {
    id: 'plan-1',
    gallery: 'plan',
    shape: 'phone',
    caption: 'Weight goal with the five rate steps and the review',
    src: null,
  },
  {
    id: 'plan-2',
    gallery: 'plan',
    shape: 'phone',
    caption: 'Targets: goal forecast, energy target and macro targets',
    src: null,
  },
  { id: 'plan-3', gallery: 'plan', shape: 'phone', caption: 'Activity Levels', src: null },
  {
    id: 'journal-1',
    gallery: 'journal',
    shape: 'phone',
    caption: 'A journal day: four slots, biometrics and the deficit pill',
    src: null,
  },
  {
    id: 'journal-2',
    gallery: 'journal',
    shape: 'phone',
    caption: 'The breakdown: macros against targets',
    src: null,
  },
  {
    id: 'journal-3',
    gallery: 'journal',
    shape: 'phone',
    caption: 'A run day: the workout row and the adjusted calories',
    src: null,
  },
  { id: 'fitness-1', gallery: 'fitness', shape: 'phone', caption: 'Fitness summary', src: null },
  {
    id: 'fitness-2',
    gallery: 'fitness',
    shape: 'phone',
    caption: 'A workout: the two-lane chart and the route',
    src: null,
  },
  {
    id: 'fitness-3',
    gallery: 'fitness',
    shape: 'phone',
    caption: 'Device sync setup with the instructions',
    src: null,
  },
  { id: 'feed-1', gallery: 'feed', shape: 'phone', caption: 'The community feed', src: null },
  {
    id: 'feed-2',
    gallery: 'feed',
    shape: 'phone',
    caption: "A member's page with Contributions",
    src: null,
  },
  {
    id: 'platform-1',
    gallery: 'platform',
    shape: 'desktop',
    caption: 'Dashboard on a desktop: rail, middle and the feed column',
    src: null,
  },
  {
    id: 'platform-2',
    gallery: 'platform',
    shape: 'phone',
    caption: 'Dashboard on a phone',
    src: null,
  },
  {
    id: 'platform-3',
    gallery: 'platform',
    shape: 'phone',
    caption: 'The Tare icon on a phone home screen',
    src: null,
  },
]

export function shotsFor(gallery: GalleryKey): Shot[] {
  return SHOTS.filter((shot) => shot.gallery === gallery)
}
