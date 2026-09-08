import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { DayEnergy } from '../api'
import { LEVEL_LABEL, calText } from '../lib/targets'

// One line of it. The value is right-aligned and tabular so the five read as a
// column of numbers rather than as five sentences.
function Line({
  label,
  note,
  value,
  total,
  // The colour the whole row reads in, for the one line that says which way
  // the day is going.
  tone,
  icon,
}: {
  label: string
  note?: string
  value: string
  total?: boolean
  tone?: string
  icon?: ReactNode
}) {
  return (
    <div
      className={`t-row min-h-9 text-sm ${tone ?? ''} ${
        total ? 'border-t border-line-strong font-semibold' : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        {label}
        {note !== undefined && <span className="text-muted"> {note}</span>}
        {icon}
      </span>
      <span className="t-nums shrink-0 text-right">{value}</span>
    </div>
  )
}

// What the weight goal is doing to the budget, said as the thing it is rather
// than as a signed number nobody reads twice.
const plannedLabel = (adjustment: number): string =>
  adjustment < 0 ? 'Planned deficit' : adjustment > 0 ? 'Planned surplus' : 'Weight goal adjustment'

// Where the day stands against what the body is using, in the same words.
const gapLabel = (gap: number): string =>
  gap > 0 ? 'Deficit so far' : gap < 0 ? 'Surplus so far' : 'Even'

const gapTone = (gap: number): string =>
  gap > 0 ? 'text-accent' : gap < 0 ? 'text-orange' : 'text-muted'

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
  gap,
  tour,
  children,
}: {
  // Null while the budget is typed in by hand or the profile is short of a
  // detail: then this is an ordinary card with nothing to open.
  energy: DayEnergy | null
  // Where the day stands against what the body is using today. Null on a
  // screen that is not about one day, and on a day nothing was logged on:
  // a deficit before breakfast is arithmetic rather than news.
  gap?: number | null
  // The name the welcome tour points at this card by, on the one screen whose
  // card it stops at.
  tour?: string
  children: ReactNode
}) {
  // The fold starts closed every time the card is opened. It is the detail
  // behind the number, not the number, so it is asked for rather than left up.
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()

  const toggle = () => setOpen(!open)

  return (
    <div data-tour={tour} className="mb-3">
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
                <Line
                  label={plannedLabel(energy.adjustment)}
                  note="(weight goal)"
                  value={signed(energy.adjustment)}
                />
                <Line label="Budget" value={`${calText(energy.budget)} cal`} total />
                {gap !== undefined && gap !== null && (
                  <Line
                    label={gapLabel(gap)}
                    value={calText(Math.abs(gap))}
                    tone={gapTone(gap)}
                    icon={
                      gap > 0 ? (
                        <Check className="ml-1 inline h-3.5 w-3.5" strokeWidth={2.5} />
                      ) : undefined
                    }
                  />
                )}
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
