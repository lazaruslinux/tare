import { Plus } from 'lucide-react'
import { useRef } from 'react'

import type { DashScreen } from '../pages/Dashboard'
import type { Screen } from '../pages/More'
import { TABS, type Page, type RailTarget, type Tab } from './TabBar'
import { TareWordmark } from './TareWordmark'

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
  invitations,
  onSelect,
  onPlus,
}: {
  active: Page
  // Which screen More and the Dashboard are showing, so a row is lit by what
  // is really on screen rather than by which page holds it.
  moreScreen: Screen
  dashScreen: DashScreen
  // Everything waiting on this account, counted on the rows that lead to it
  // the same way the tab bar counts it.
  waiting: number
  // The share of that which is unanswered calendar invitations. Calendar is a
  // row of its own at this width, so it carries them and More does not.
  invitations: number
  onSelect: (target: RailTarget) => void
  // Where the button is, so the add menu can hang off it instead of rising
  // from the bottom of a window it is nowhere near.
  onPlus: (anchor: DOMRect | null) => void
}) {
  const plus = useRef<HTMLButtonElement>(null)

  const isCurrent = (id: Tab): boolean => {
    if (id === 'targets') return active === 'more' && moreScreen === 'targets'
    if (id === 'fitness') return active === 'more' && moreScreen === 'fitness'
    if (id === 'calendar') return active === 'more' && moreScreen === 'calendar'
    if (id === 'measurements') return active === 'dashboard' && dashScreen === 'progress'
    // A page's own row is lit only while that page is at its root.
    if (id === 'more') return active === 'more' && moreScreen === null
    if (id === 'dashboard') return active === 'dashboard' && dashScreen === null
    return id === active
  }

  return (
    <nav aria-label="Main" className="t-rail">
      <span className="flex px-3 pb-4">
        <TareWordmark size={22} />
      </span>
      <button
        ref={plus}
        data-tour="rail-plus"
        onClick={() => onPlus(plus.current?.getBoundingClientRect() ?? null)}
        className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-[0.625rem] bg-accent px-3 text-sm font-semibold text-bg"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} /> Add
      </button>
      {TABS.filter(({ id }) => id !== 'plus').map(({ id, label, Icon }) => {
        const target = id as RailTarget
        // What this row is holding. More's number must be what the rows
        // inside More add up to, and at this width the invitations are on the
        // Calendar row instead of under More.
        const count =
          id === 'more' ? waiting - invitations : id === 'calendar' ? invitations : 0
        return (
          <button
            key={id}
            data-tour={id === 'targets' ? 'rail-targets' : undefined}
            onClick={() => onSelect(target)}
            aria-current={isCurrent(id) ? 'page' : undefined}
            aria-label={count > 0 ? `${label}, ${count} waiting` : undefined}
            className="t-navitem"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {label}
            {/* At this width the row has room, so the count sits at its end
                rather than over the icon. `static` beats .t-count's absolute:
                utilities sort after components. */}
            {count > 0 && <span className="t-count t-nums static ml-auto">{count}</span>}
          </button>
        )
      })}
    </nav>
  )
}
