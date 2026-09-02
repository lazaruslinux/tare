import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect } from 'react'

import { Sheet } from './Sheet'

// The width the rail shows instead of the bar. A popover only makes sense
// where there is a rail button to hang it off.
const WIDE = '(min-width: 900px)'

// How far the popover sits from the button, and how wide it is.
const GAP = 8
const WIDTH = 240

// What the centre action offers, in the order it was laid out.
function Items({ rows }: { rows: { label: string; onPick: () => void }[] }) {
  return (
    <>
      <p className="t-micro mb-1">Add</p>
      {rows.map((row) => (
        <button
          key={row.label}
          type="button"
          className="t-row w-full text-left"
          onClick={row.onPick}
        >
          {row.label}
        </button>
      ))}
    </>
  )
}

export function PlusSheet({
  open,
  anchor,
  onClose,
  onScan,
  onAddFood,
  onMeasure,
  onExercise,
}: {
  open: boolean
  // Where the rail's button is. Null when the tab bar asked, which is the case
  // the sheet was built for.
  anchor: DOMRect | null
  onClose: () => void
  onScan: () => void
  onAddFood: () => void
  onMeasure: () => void
  onExercise: () => void
}) {
  const reduced = useReducedMotion()
  const rows = [
    { label: 'Scan food', onPick: onScan },
    { label: 'Add food', onPick: onAddFood },
    { label: 'Measurements', onPick: onMeasure },
    { label: 'Manual exercise', onPick: onExercise },
  ]
  const popover = anchor !== null && window.matchMedia(WIDE).matches

  useEffect(() => {
    if (!open || !popover) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, popover, onClose])

  if (!popover) {
    return (
      <Sheet open={open} label="Add" onClose={onClose}>
        <Items rows={rows} />
      </Sheet>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            role="dialog"
            aria-label="Add"
            className="absolute rounded-xl border border-line bg-surface px-3 py-2 shadow-lg"
            style={{ top: anchor.top, left: anchor.right + GAP, width: WIDTH }}
            initial={{ opacity: 0, x: reduced ? 0 : -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : -6 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <Items rows={rows} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
