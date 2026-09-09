import { useState } from 'react'

import { useTopBar } from '../hooks/useTopBar'
import {
  MOVES,
  MOVES_NOTE,
  PLACE_CHIPS,
  PLACE_LABEL,
  inPlace,
  type MoveItem,
  type Place,
} from '../lib/moves'

// The last chip is remembered per device: somebody with a sore back comes back
// to the back.
const PLACE_KEY = 'tare.moves.place'

type Chip = Place | 'all'

function rememberedPlace(): Chip {
  try {
    const kept = window.localStorage.getItem(PLACE_KEY)
    return PLACE_CHIPS.some((row) => row.key === kept) ? (kept as Chip) : 'all'
  } catch {
    return 'all'
  }
}

// The two groups, in the order the doc writes them.
const GROUPS: { key: MoveItem['group']; label: string }[] = [
  { key: 'stretch', label: 'Stretches' },
  { key: 'move', label: 'Bodyweight moves' },
]

function MoveDetail({ item, onBack }: { item: MoveItem; onBack: () => void }) {
  useTopBar({ title: item.name, back: { label: 'Stretches & Bodyweight Exercises', onBack } })

  return (
    <div className="t-card mb-3">
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-lg">{item.name}</h2>
        <span className="t-chip shrink-0">{PLACE_LABEL[item.place]}</span>
      </div>

      <ol className="ml-4 mt-3 list-decimal text-sm">
        {item.steps.map((step) => (
          <li key={step} className="mb-2">
            {step}
          </li>
        ))}
      </ol>

      <p className="t-micro mt-4">How much</p>
      <p className="text-sm">{item.howMuch}</p>

      <p className="t-micro mt-3">For</p>
      <p className="text-sm">{item.forLine}</p>

      {item.skipIf !== undefined && (
        <>
          <p className="t-micro mt-3">Skip it if</p>
          <p className="text-sm">{item.skipIf}</p>
        </>
      )}
    </div>
  )
}

export function Moves({ onBack }: { onBack: () => void }) {
  const [chip, setChip] = useState<Chip>(rememberedPlace)
  const [open, setOpen] = useState<MoveItem | null>(null)

  useTopBar(open === null ? { title: 'Stretches & Bodyweight Exercises', back: { label: 'Fitness', onBack } } : null)

  if (open !== null) return <MoveDetail item={open} onBack={() => setOpen(null)} />

  const pick = (key: Chip) => {
    setChip(key)
    try {
      window.localStorage.setItem(PLACE_KEY, key)
    } catch {
      // A browser that refuses storage still gets the chip it picked.
    }
  }

  const shown = MOVES.filter((item) => inPlace(item, chip))

  return (
    <>
      <p className="mb-3 text-sm text-muted">{MOVES_NOTE}</p>

      <div className="mb-3 flex gap-x-2 gap-y-4 overflow-x-auto min-[900px]:flex-wrap">
        {PLACE_CHIPS.map((one) => (
          <button
            key={one.key}
            type="button"
            className="t-chip t-tap44 shrink-0 aria-pressed:border-accent aria-pressed:text-text"
            aria-pressed={chip === one.key}
            onClick={() => pick(one.key)}
          >
            {one.label}
          </button>
        ))}
      </div>

      {GROUPS.map((group) => {
        const rows = shown.filter((item) => item.group === group.key)
        // A chip that empties a group takes the whole card with it.
        if (rows.length === 0) return null
        return (
          <div key={group.key} className="t-card mb-3">
            <p className="t-micro mb-1">{group.label}</p>
            {rows.map((item) => (
              <button
                key={item.id}
                type="button"
                className="t-row w-full text-left"
                onClick={() => setOpen(item)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{item.name}</span>
                  <span className="block text-xs text-muted">{item.forLine}</span>
                </span>
                <span className="t-chip shrink-0">{PLACE_LABEL[item.place]}</span>
              </button>
            ))}
          </div>
        )
      })}
    </>
  )
}
