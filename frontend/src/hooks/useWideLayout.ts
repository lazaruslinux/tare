import { useEffect, useState } from 'react'

// The two widths the shell changes shape at, as a signal React can read. The
// rest of the shell is pure CSS; these two gate a React branch on purpose, so
// a phone never mounts what it cannot show.
const WIDE = '(min-width: 1200px)'
const RAIL = '(min-width: 900px)'

function useQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    media.addEventListener('change', onChange)
    // A resize between render and effect would otherwise be missed.
    setMatches(media.matches)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// True once there is room for the right-hand column beside the content well.
export function useWideLayout(): boolean {
  return useQuery(WIDE)
}

// True once the side rail is the navigation. What the rail already lists is
// not repeated on the More screen, and this is how that screen knows.
export function useRailLayout(): boolean {
  return useQuery(RAIL)
}
