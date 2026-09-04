import { Activity, Bike, Dumbbell, Footprints, Mountain, PersonStanding, Waves } from 'lucide-react'
import type { ReactNode } from 'react'

// A picture beside a workout's name, so a list of mornings reads at a glance
// rather than word by word.
//
// The name is all there is to go on: somebody logs "Walking", a phone sends
// "Outdoor Walk", and both mean the same thing. So the word inside the name is
// what is matched, and anything unrecognised gets the plain mark rather than a
// gap. Every icon is muted: the colour would be saying something it does not
// know.

// Lucide has no running figure, so Tare draws its own in the same hand: a head,
// a leaning body, one arm forward, and legs mid-stride.
function Runner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-runner ${className ?? ''}`}
      aria-hidden="true"
    >
      <circle cx="17" cy="4.5" r="2" />
      <path d="M15.5 8 11 12.5" />
      <path d="M15.5 8 19.5 10.5" />
      <path d="M15.5 8 12 6" />
      <path d="M11 12.5 14 16 12.5 20" />
      <path d="M11 12.5 7 14.5 4.5 12" />
    </svg>
  )
}

type Drawing = (props: { className?: string }) => ReactNode

// Read top to bottom, first match wins: the named things before the catch-all.
const ICONS: [RegExp, Drawing][] = [
  [/run|jog/i, Runner],
  [/walk/i, Footprints],
  [/hik/i, Mountain],
  [/strength|weight|lift|dumbbell|barbell|kettlebell/i, Dumbbell],
  [/cycl|bike|biking|spin/i, Bike],
  [/swim/i, Waves],
  [/yoga|stretch|pilates|mobility/i, PersonStanding],
  [/row|elliptical|stair|hiit|interval|cardio|danc|other/i, Activity],
]

export function ActivityIcon({ name, className }: { name: string; className?: string }) {
  const found = ICONS.find(([word]) => word.test(name))
  const Drawn = found === undefined ? Activity : found[1]
  return <Drawn className={className} />
}
