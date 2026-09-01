import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

// What the centre action offers. Every row is disabled: this round builds the
// shell, and each of these arrives with the feature behind it.
const ROWS = ['Scan food', 'Add food', 'Weigh-in', 'Manual exercise']

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduced = useReducedMotion()
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 min-[900px]:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-label="Add"
            className="w-full max-w-md rounded-t-2xl border-t border-line bg-surface px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] min-[900px]:max-w-sm min-[900px]:rounded-2xl min-[900px]:border min-[900px]:pb-4"
            initial={{ y: reduced ? 0 : 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: reduced ? 0 : 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            <p className="t-micro mb-1">Add</p>
            {ROWS.map((row) => (
              <button key={row} disabled className="t-row w-full text-left opacity-40">
                {row}
              </button>
            ))}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
