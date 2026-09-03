import { useEffect, useRef } from 'react'

// Coming back to the app. A phone leaves a tab open for days, and what it is
// showing when somebody looks at it again is whatever was true when they put
// it down. This says the moment they are looking again, so the screen can read
// the server rather than argue with an old answer.
//
// Three events for one thing, because no single one of them fires everywhere:
// a tab uncovered gives visibilitychange, a window brought forward gives focus,
// and a page restored from the back-forward cache gives pageshow. iOS gives all
// three at once, so they are held to one call in a short window.
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
