import { useEffect, useRef } from 'react'

// Coming back to the app. A phone leaves a tab open for days, so what it shows
// is whatever was true when it was put down, and this says the moment somebody
// is looking again so the screen can read the server instead. Three events,
// because no single one of them fires everywhere, held to one call in a short
// window because iOS sends all three at once.
const QUIET = 5000

export function useResume(onResume: () => void) {
  // The latest callback, so the listeners are attached once rather than torn
  // down and rebuilt every render.
  const latest = useRef(onResume)
  latest.current = onResume
  const last = useRef(0)

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - last.current < QUIET) return
      last.current = now
      latest.current()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
    return () => {
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('pageshow', wake)
    }
  }, [])
}
