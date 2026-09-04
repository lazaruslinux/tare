import { Activity, PersonStanding, Waves } from 'lucide-react'
import type { ReactNode } from 'react'

// A picture beside a workout's name, so a list of mornings reads at a glance
// rather than word by word.
//
// The name is all there is to go on: somebody logs "Walking", a phone sends
// "Outdoor Walk", and both mean the same thing. So the word inside the name is
// what is matched, and anything unrecognised gets the plain mark rather than a
// gap. Every icon is muted: the colour would be saying something it does not
// know.

// Tare's own figures, drawn in one hand: a filled head and thick round limbs,
// the way workout pictograms are drawn everywhere, so they read at 16 px and
// nothing in them is copied from anyone.
const LIMB = 2.6

function Figure({ className, name, children }: { className?: string; name: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={LIMB}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${name} ${className ?? ''}`}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const Head = ({ cx, cy, r = 2.1 }: { cx: number; cy: number; r?: number }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
)

function Run({ className }: { className?: string }) {
  return (
    <Figure name="runner" className={className}>
      <Head cx={15.4} cy={3.4} />
      <path d="M14.2 7.4 12.4 13" />
      <path d="M14.2 7.4 17.2 9.8 20 8.2" />
      <path d="M14.2 7.4 11.2 10 8.4 8.6" />
      <path d="M12.4 13 16.4 14 15 19.2" />
      <path d="M12.4 13 9 16.2 6.2 14.4" />
    </Figure>
  )
}

function Walk({ className }: { className?: string }) {
  return (
    <Figure name="walker" className={className}>
      <Head cx={12.8} cy={3.4} />
      <path d="M12.6 7.4 12 13.2" />
      <path d="M12.6 7.4 14.6 10.6 17.2 10" />
      <path d="M12.6 7.4 10.2 11.8" />
      <path d="M12 13.2 14.2 16.6 15.4 20.6" />
      <path d="M12 13.2 10.2 16.8 8.6 20.4" />
    </Figure>
  )
}

function Hike({ className }: { className?: string }) {
  return (
    <Figure name="hiker" className={className}>
      <Head cx={13.6} cy={3.4} />
      <rect x="7.4" y="7.4" width="3.8" height="6.2" rx="1.7" fill="currentColor" stroke="none" />
      <path d="M12.8 7.2 11.2 13" />
      <path d="M12.8 7.2 15.8 9.4 17.6 11.6" />
      <path d="M17.2 8.4 18.8 21" strokeWidth={1.8} />
      <path d="M12.8 7.2 10.2 11.2" />
      <path d="M11.2 13 14.8 15.8 15.2 20.6" />
      <path d="M11.2 13 8.2 16.6 5.4 19.8" />
    </Figure>
  )
}

function Cycle({ className }: { className?: string }) {
  return (
    <Figure name="cyclist" className={className}>
      <Head cx={18.4} cy={4.6} r={2} />
      <circle cx="5.4" cy="17.4" r="3.6" strokeWidth={1.9} />
      <circle cx="18.6" cy="17.4" r="3.6" strokeWidth={1.9} />
      <path d="M9.8 9.8 14.8 7.6" />
      <path d="M14.8 7.6 17.6 11.4" />
      <path d="M9.8 9.8 12.8 12.6 11.4 16" />
      <path d="M5.4 17.4 9.8 11" strokeWidth={1.9} />
      <path d="M11.4 16 14.8 17.4" strokeWidth={1.9} />
    </Figure>
  )
}

function Lunge({ className }: { className?: string }) {
  return (
    <Figure name="lunge" className={className}>
      <Head cx={12.4} cy={3.4} />
      <path d="M11.8 7.2 11 13.4" />
      <path d="M11.8 7.4 9.2 9.8 13 10.4" />
      <path d="M11 13.4 16.2 13.6 16.4 19.6" />
      <path d="M11 13.4 7.4 17.6 3.4 18.2" />
    </Figure>
  )
}

function Lift({ className }: { className?: string }) {
  return (
    <Figure name="lifter" className={className}>
      <Head cx={12} cy={3.4} />
      <rect x="9.6" y="6.6" width="4.8" height="6.4" rx="2.2" fill="currentColor" stroke="none" />
      <path d="M9.8 8.2 8.6 13.6" strokeWidth={2.2} />
      <path d="M14.2 8.2 15.4 13.6" strokeWidth={2.2} />
      <path d="M3 13.6 21 13.6" strokeWidth={1.6} />
      <path d="M5.6 11 5.6 16.2" strokeWidth={2.2} />
      <path d="M18.4 11 18.4 16.2" strokeWidth={2.2} />
      <path d="M10.6 12.6 9.2 20.4" />
      <path d="M13.4 12.6 14.8 20.4" />
    </Figure>
  )
}

type Drawing = (props: { className?: string }) => ReactNode

// Read top to bottom, first match wins: the named things before the catch-all.
const ICONS: [RegExp, Drawing][] = [
  [/run|jog/i, Run],
  [/walk/i, Walk],
  [/hik/i, Hike],
  [/functional/i, Lunge],
  [/strength|weight|lift|dumbbell|barbell|kettlebell/i, Lift],
  [/cycl|bike|biking|spin/i, Cycle],
  [/swim/i, Waves],
  [/yoga|stretch|pilates|mobility/i, PersonStanding],
  [/row|elliptical|stair|hiit|interval|cardio|danc|other/i, Activity],
]

export function ActivityIcon({ name, className }: { name: string; className?: string }) {
  const found = ICONS.find(([word]) => word.test(name))
  const Drawn = found === undefined ? Activity : found[1]
  return <Drawn className={className} />
}
