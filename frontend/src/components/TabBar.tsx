import { motion } from 'framer-motion'
import { Apple, BookOpen, Ellipsis, LayoutDashboard, Plus, type LucideIcon } from 'lucide-react'

export type Tab = 'dashboard' | 'journal' | 'plus' | 'food' | 'more'
export type Page = Exclude<Tab, 'plus'>

// The one list both navigations read, so the bar and the rail cannot drift
// apart. The centre slot is an action rather than a destination: it opens the
// add sheet and never becomes the current page.
export const TABS: { id: Tab; label: string; Icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'journal', label: 'Journal', Icon: BookOpen },
  { id: 'plus', label: 'Add', Icon: Plus },
  { id: 'food', label: 'Food', Icon: Apple },
  { id: 'more', label: 'More', Icon: Ellipsis },
]

export function TabBar({
  active,
  onSelect,
  onPlus,
}: {
  active: Page
  onSelect: (page: Page) => void
  onPlus: () => void
}) {
  return (
    <nav aria-label="Main" className="t-tabbar">
      <div className="mx-auto flex w-full max-w-md items-end justify-around pt-1.5">
        {TABS.map(({ id, label, Icon }) => {
          if (id === 'plus') {
            return (
              <button key={id} onClick={onPlus} aria-label={label} className="t-plus">
                <Icon className="h-6 w-6" strokeWidth={2.25} />
              </button>
            )
          }
          const page = id as Page
          const isActive = page === active
          return (
            <button
              key={id}
              onClick={() => onSelect(page)}
              aria-current={isActive ? 'page' : undefined}
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
              <Icon className={`relative h-5 w-5 ${isActive ? 'text-accent' : ''}`} strokeWidth={2} />
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
