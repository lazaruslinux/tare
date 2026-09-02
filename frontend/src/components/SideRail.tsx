import { Plus } from 'lucide-react'
import { useRef } from 'react'

import { TABS, type Page } from './TabBar'

// The desktop navigation. It reads the same TABS list as the bar, so the two
// can only ever show the same destinations in the same order. The centre
// action is not a rail item: at this width it is a plain primary button.
export function SideRail({
  active,
  onSelect,
  onPlus,
}: {
  active: Page
  onSelect: (page: Page) => void
  // Where the button is, so the add menu can hang off it instead of rising
  // from the bottom of a window it is nowhere near.
  onPlus: (anchor: DOMRect | null) => void
}) {
  const plus = useRef<HTMLButtonElement>(null)
  return (
    <nav aria-label="Main" className="t-rail">
      <span className="px-3 pb-4 text-xl font-semibold tracking-tight lowercase">tare</span>
      <button
        ref={plus}
        onClick={() => onPlus(plus.current?.getBoundingClientRect() ?? null)}
        className="mb-2 flex min-h-11 items-center justify-center gap-2 rounded-[0.625rem] bg-accent px-3 text-sm font-semibold text-bg"
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} /> Add
      </button>
      {TABS.filter(({ id }) => id !== 'plus').map(({ id, label, Icon }) => {
        const page = id as Page
        return (
          <button
            key={id}
            onClick={() => onSelect(page)}
            aria-current={page === active ? 'page' : undefined}
            className="t-navitem"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
