import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

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
    { label: 'Scan item', onPick: onScan },
    { label: 'Add to Journal', onPick: onAddFood },
    { label: 'Biometrics', onPick: onMeasure },
    { label: 'Manual exercise', onPick: onExercise },
  ]
  const popover = anchor !== null && window.matchMedia(WIDE).matches
  // How tall the tab bar stands, read when the sheet opens: the sheet rises
  // from behind it and stops at its top edge, so the bar stays in view.
  const [barHeight, setBarHeight] = useState(0)

  useEffect(() => {
    if (!open) return
    setBarHeight(document.querySelector('.t-tabbar')?.getBoundingClientRect().height ?? 0)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!popover) {
    // Drawn here rather than with Sheet: this one sits under the bar (z below
    // the bar's own), ends where the bar begins, and leaves room at the bottom
    // for the raised centre button that overhangs the bar.
    return (
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-x-0 top-0 z-20 flex items-end justify-center bg-black/50"
            style={{ bottom: barHeight }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          >
            <motion.div
              role="dialog"
              aria-label="Add"
              className="w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pt-4 pb-8 max-h-[86svh]"
              initial={{ y: reduced ? 0 : 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: reduced ? 0 : 24, opacity: 0 }}
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
