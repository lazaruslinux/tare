import { Plus } from 'lucide-react'
import { useRef } from 'react'

import type { DashScreen } from '../pages/Dashboard'
import type { Screen } from '../pages/More'
import { TABS, type Page, type RailTarget, type Tab } from './TabBar'
import { TareMark } from './TareMark'

// The desktop navigation. It reads the same TABS list as the bar, so the two
// can only ever show the same destinations in the same order. The centre
// action is not a rail item: at this width it is a plain primary button. Two
// of the rows lead to a screen inside a page rather than to a page, which is
// why this is told which screen those two pages are on.
export function SideRail({
  active,
  moreScreen,
  dashScreen,
  waiting,
  onSelect,
  onPlus,
}: {
  active: Page
  // Which screen More and the Dashboard are showing, so a row is lit by what
  // is really on screen rather than by which page holds it.
  moreScreen: Screen
  dashScreen: DashScreen
  // Submissions waiting on an administrator, counted on the row that leads to
  // them the same way the tab bar counts them.
  waiting: number
  onSelect: (target: RailTarget) => void
  // Where the button is, so the add menu can hang off it instead of rising
  // from the bottom of a window it is nowhere near.
  onPlus: (anchor: DOMRect | null) => void
}) {
  const plus = useRef<HTMLButtonElement>(null)

  const isCurrent = (id: Tab): boolean => {
    if (id === 'targets') return active === 'more' && moreScreen === 'targets'
    if (id === 'fitness') return active === 'more' && moreScreen === 'fitness'
    if (id === 'measurements') return active === 'dashboard' && dashScreen === 'progress'
    // A page's own row is lit only while that page is at its root.
    if (id === 'more') return active === 'more' && moreScreen === null
    if (id === 'dashboard') return active === 'dashboard' && dashScreen === null
    return id === active
  }

  return (
    <nav aria-label="Main" className="t-rail">
      <span className="flex items-center gap-2 px-3 pb-4 text-xl font-semibold tracking-tight">
        <TareMark className="h-6 w-6" />
        Tare
      </span>
      <button
        ref={plus}
        onClick={() => onPlus(plus.current?.getBoundingClientRect() ?? null)}
        className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-[0.625rem] bg-accent px-3 text-sm font-semibold text-bg"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} /> Add
      </button>
      {TABS.filter(({ id }) => id !== 'plus').map(({ id, label, Icon }) => {
        const target = id as RailTarget
        const counted = id === 'more' && waiting > 0
        return (
          <button
            key={id}
            onClick={() => onSelect(target)}
            aria-current={isCurrent(id) ? 'page' : undefined}
            aria-label={counted ? `${label}, ${waiting} waiting` : undefined}
            className="t-navitem"
          >
            <span className="relative flex">
              <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              {counted && <span className="t-count t-nums -top-2 -right-2.5">{waiting}</span>}
            </span>
            {label}
          </button>
        )
      })}
    </nav>
  )
}
