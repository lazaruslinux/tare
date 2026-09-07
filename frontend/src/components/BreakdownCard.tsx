import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import type { DayEnergy } from '../api'
import { LEVEL_LABEL, calText } from '../lib/targets'

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

// A card with the day's five figures folded under it. The tab is a real
// sibling of the card rather than something inside it, which is the only way
// it can hang under the card at the card's own width; that is why this owns
// the card instead of sitting in one.
export function BreakdownCard({
  energy,
  reveal,
  children,
}: {
  // Null while the budget is typed in by hand or the profile is short of a
  // detail: then this is an ordinary card with nothing to open.
  energy: DayEnergy | null
  // Bumped by whatever owns the card to open the fold from inside it, the
  // way a badge that stands for one of the five figures does.
  reveal?: number
  children: ReactNode
}) {
  // The fold starts closed every time the card is opened. It is the detail
  // behind the number, not the number, so it is asked for rather than left up.
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reveal === undefined || reveal === 0) return
    setOpen(true)
  }, [reveal])

  const toggle = () => setOpen(!open)

  return (
    <div className="mb-3">
      <div className={`t-card${energy === null ? '' : ' t-card-tabbed'}`}>
        {children}
        <AnimatePresence initial={false}>
          {open && energy !== null && (
            <motion.div
              className="overflow-hidden"
              initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div className="mt-3">
                <Line label="BMR" value={calText(energy.resting)} />
                <Line
                  label="Your day"
                  note={LEVEL_LABEL[energy.level]}
                  value={added(energy.activity)}
                />
                <Line label="Exercise (Workouts)" value={added(energy.exercise)} />
                <Line label="Weight goal adjustment" value={signed(energy.adjustment)} />
                <Line label="Budget" value={`${calText(energy.budget)} cal`} total />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {energy !== null && (
        <button
          type="button"
          className="t-tab t-micro t-tap44 text-accent"
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? 'Hide breakdown' : 'Show breakdown'}
          <ChevronDown
            className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`}
            strokeWidth={2.5}
          />
        </button>
      )}
    </div>
  )
}
