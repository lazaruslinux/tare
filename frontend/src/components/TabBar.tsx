import { motion } from 'framer-motion'
import {
  Apple,
  BookOpen,
  Ellipsis,
  HeartPulse,
  LayoutDashboard,
  Plus,
  Target,
  type LucideIcon,
} from 'lucide-react'

import { ScaleGlyph } from './ScaleGlyph'

export type Tab =
  | 'dashboard'
  | 'journal'
  | 'plus'
  | 'food'
  | 'targets'
  | 'measurements'
  | 'fitness'
  | 'more'
// A page the shell can be on. The centre action is not one, and neither are
// the two rail rows: each of those opens a screen inside a page.
export type Page = Exclude<Tab, 'plus' | 'targets' | 'measurements' | 'fitness'>
// What the rail can be asked for, which is every row it draws.
export type RailTarget = Exclude<Tab, 'plus'>

// The one list both navigations read, so the bar and the rail cannot drift
// apart. The centre slot is an action rather than a destination: it opens the
// add sheet and never becomes the current page. A railOnly row has no room on
// a phone, where the screen it leads to is reached through its own page.
// A glyph is either one of lucide's or one drawn here, and both take the same
// two props, so the lists below do not care which they were handed.
export type Glyph = LucideIcon | typeof ScaleGlyph

export const TABS: { id: Tab; label: string; Icon: Glyph; railOnly?: true }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'journal', label: 'Journal', Icon: BookOpen },
  { id: 'plus', label: 'Add', Icon: Plus },
  { id: 'food', label: 'Food', Icon: Apple },
  { id: 'targets', label: 'Targets', Icon: Target, railOnly: true },
  { id: 'measurements', label: 'Biometrics', Icon: ScaleGlyph, railOnly: true },
  { id: 'fitness', label: 'Fitness', Icon: HeartPulse, railOnly: true },
  { id: 'more', label: 'More', Icon: Ellipsis },
]

export function TabBar({
  active,
  waiting,
  onSelect,
  onPlus,
}: {
  active: Page
  // Submissions waiting on an administrator, which is nought for everybody
  // else. The screen that shows them is behind More, so the count rides there.
  waiting: number
  onSelect: (page: Page) => void
  onPlus: () => void
}) {
  return (
    <nav aria-label="Main" className="t-tabbar">
      <div className="mx-auto flex w-full max-w-md items-end justify-around pt-1.5">
        {TABS.filter((tab) => !tab.railOnly).map(({ id, label, Icon }) => {
          if (id === 'plus') {
            return (
              <button key={id} onClick={onPlus} aria-label={label} className="t-plus">
                <Icon className="h-6 w-6" strokeWidth={2.25} />
              </button>
            )
          }
          const page = id as Page
          const isActive = page === active
          const counted = id === 'more' && waiting > 0
          return (
            <button
              key={id}
              onClick={() => onSelect(page)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={counted ? `${label}, ${waiting} waiting` : undefined}
              className="t-tabitem"
            >
              {isActive && (
                // One shared highlight that glides between tabs.
                <motion.span
                  layoutId="tare-tab-highlight"
                  className="absolute inset-0 rounded-xl bg-surface-2"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative flex">
                <Icon className={`h-5 w-5 ${isActive ? 'text-accent' : ''}`} strokeWidth={2} />
                {counted && <span className="t-count t-nums -top-1 -right-2">{waiting}</span>}
              </span>
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
