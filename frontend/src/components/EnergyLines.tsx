import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Calculator } from 'lucide-react'
import { useState } from 'react'

import type { DayEnergy } from '../api'
import { LEVEL_LABEL, calText } from '../lib/targets'

// Whether the fold is open, remembered per device. A member who wants to see
// where the number comes from usually wants to see it tomorrow as well.
const KEY = 'tare.breakdown.open'

function remembered(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'yes'
  } catch {
    // A browser that refuses storage still gets the fold, it just forgets.
    return false
  }
}

export function useBreakdown(): [boolean, () => void] {
  const [open, setOpen] = useState(remembered)
  const toggle = () => {
    const next = !open
    setOpen(next)
    try {
      window.localStorage.setItem(KEY, next ? 'yes' : 'no')
    } catch {
      // Nothing to do about it, and nothing worth saying on screen.
    }
  }
  return [open, toggle]
}

// The way in: an icon and no words. The lines under it say what they are, and
// a sentence in the card head would be a third thing to read before the number.
export function BreakdownButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="t-tap44 text-muted"
      aria-label="Breakdown"
      aria-expanded={open}
      onClick={onToggle}
    >
      <Calculator className="h-4 w-4" strokeWidth={2} />
    </button>
  )
}

// One line of it. The value is right-aligned and tabular so the five read as a
// column of numbers rather than as five sentences.
function Line({
  label,
  note,
  value,
  total,
}: {
  label: string
  note?: string
  value: string
  total?: boolean
}) {
  return (
    <div
      className={`t-row min-h-9 text-sm ${
        total ? 'border-t border-line-strong font-semibold' : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        {label}
        {note !== undefined && <span className="text-muted"> {note}</span>}
      </span>
      <span className="t-nums shrink-0 text-right">{value}</span>
    </div>
  )
}

// A figure that is added on, and one that can go either way.
const added = (value: number): string => `+${calText(value)}`
const signed = (value: number): string =>
  value === 0 ? '0' : value > 0 ? `+${calText(value)}` : `−${calText(Math.abs(value))}`

// Where a day's budget came from, in the five figures it is made of. The unit
// is said once, on the line the other four add up to.
export function EnergyLines({ energy }: { energy: DayEnergy }) {
  return (
    <div>
      <Line label="At rest" value={calText(energy.resting)} />
      <Line label="Your day" note={LEVEL_LABEL[energy.level]} value={added(energy.activity)} />
      <Line label="Exercise" value={added(energy.exercise)} />
      <Line label="Goal rate" value={signed(energy.adjustment)} />
      <Line label="Budget" value={`${calText(energy.budget)} cal`} total />
    </div>
  )
}

// The fold itself. It opens under whatever it was asked for from, and it never
// moves when somebody has asked for less motion.
export function BreakdownFold({ open, energy }: { open: boolean; energy: DayEnergy }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="overflow-hidden"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="mt-3">
            <EnergyLines energy={energy} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
