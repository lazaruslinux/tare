import { useCallback, useEffect, useRef, useState } from 'react'

// How long the confirmation stays up. Long enough to be read, short enough
// that it is gone before anybody wonders whether it is stuck.
const SHOWN = 3000

// What a form says about itself beside its Save button: that there is
// something to save, or that it just did.
export function SaveMarks({ dirty, saved }: { dirty: boolean; saved: boolean }) {
  if (dirty) return <span className="text-xs text-muted">Unsaved changes</span>
  if (saved) return <span className="t-chip text-accent">Saved.</span>
  return null
}

// The chip's own timer, so no screen keeps one of these by hand.
export function useSavedChip(): [boolean, () => void] {
  const [saved, setSaved] = useState(false)
  const timer = useRef(0)

  const mark = useCallback(() => {
    window.clearTimeout(timer.current)
    setSaved(true)
    timer.current = window.setTimeout(() => setSaved(false), SHOWN)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [saved, mark]
}
