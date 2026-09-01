import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

// The one thing that opens over a page. Everything that does uses this, so the
// backdrop, the corner, the safe area and the motion are decided once instead
// of drifting apart across three screens.
//
// It rises from the bottom on a phone and sits in the middle on a desktop,
// because a sheet pinned to the bottom of a tall window is a long way from
// where somebody was looking.
export function Sheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean
  label: string
  onClose: () => void
  children: ReactNode
}) {
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
            aria-label={label}
            // Capped and scrollable: a long list inside must not push the
            // controls at the bottom off the screen.
            className="max-h-[86svh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-line bg-surface px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] min-[900px]:max-w-sm min-[900px]:rounded-2xl min-[900px]:border min-[900px]:pb-4"
            initial={{ y: reduced ? 0 : 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: reduced ? 0 : 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={(event) => event.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
