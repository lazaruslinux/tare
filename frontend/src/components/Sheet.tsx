import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, type ReactNode } from 'react'

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
  tall,
  center,
  full,
  wide,
  top,
  onClose,
  children,
}: {
  open: boolean
  label: string
  // For the one sheet that is a whole form rather than a choice. It takes as
  // much of the screen as it can and stays a sheet, because what opened it was
  // a scan and going back to it is one gesture.
  tall?: boolean
  // For a sheet whose content is a picture rather than a list: the whole
  // screen on a phone, a wide panel on a desktop, and a column, so what is in
  // it takes the room the words below it leave.
  full?: boolean
  // For a sheet that is a long list somebody is looking something up in. The
  // same sheet as ever on a phone; on a desktop it takes the width to read the
  // list in two columns, because a column of three hundred rows down the
  // middle of a wide window is a scroll and not a catalog.
  wide?: boolean
  // A short message that should sit in the middle of the screen at every
  // width, the way a thank-you does, rather than rise from the bottom.
  center?: boolean
  // For a sheet somebody types into. On a phone it hangs from the top, so the
  // box and what it finds stay above the keyboard instead of behind it; on a
  // desktop it sits in the middle like the others.
  top?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  // Escape closes the sheet on top and only that one, so two layers peel one
  // at a time.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const dialogs = document.querySelectorAll('[role=dialog]')
      if (dialogs[dialogs.length - 1] !== box.current) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`fixed inset-0 z-40 flex justify-center bg-black/50 ${
            center ? 'items-center px-4' : top ? 'items-start min-[900px]:items-center' : 'items-end min-[900px]:items-center'
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
        >
          <motion.div
            ref={box}
            role="dialog"
            aria-label={label}
            // Capped and scrollable: a long list inside must not push the
            // controls at the bottom off the screen.
            className={
              full
                ? 'flex h-[100svh] w-full flex-col overflow-hidden border-t border-line bg-surface px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] min-[900px]:h-[86svh] min-[900px]:max-w-3xl min-[900px]:rounded-2xl min-[900px]:border min-[900px]:pb-4'
                : center
                ? 'w-full max-w-sm overflow-y-auto rounded-2xl border border-line bg-surface p-4 max-h-[86svh]'
                : `w-full max-w-md overflow-y-auto border-line bg-surface px-4 min-[900px]:rounded-2xl min-[900px]:border min-[900px]:pt-4 min-[900px]:pb-4 ${
                    top
                      ? 'rounded-b-2xl border-b pt-[calc(1rem+env(safe-area-inset-top))] pb-4'
                      : 'rounded-t-2xl border-t pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'
                  } ${
                    wide
                      ? 'max-h-[94svh] min-[900px]:max-h-[86svh] min-[900px]:max-w-3xl'
                      : tall
                        ? 'max-h-[94svh] min-[900px]:max-w-md'
                        : 'max-h-[86svh] min-[900px]:max-w-sm'
                  }`
            }
            initial={{ y: reduced ? 0 : top ? -24 : 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: reduced ? 0 : top ? -24 : 24, opacity: 0 }}
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
