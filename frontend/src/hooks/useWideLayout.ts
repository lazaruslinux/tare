import { useEffect, useState } from 'react'

// True once there is room for the right-hand column beside the content well.
// The shell's other two shapes are pure CSS; this one gates a React branch on
// purpose, so a phone never mounts a column it cannot show.
const WIDE = '(min-width: 1200px)'

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches)
  useEffect(() => {
    const query = window.matchMedia(WIDE)
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches)
    query.addEventListener('change', onChange)
    // A resize between render and effect would otherwise be missed.
    setWide(query.matches)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}
