import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// What the bar says for the screen that is on. A back means the screen is a
// sub-view: the bar draws the control, and the browser gets an entry so its
// own back button closes the sub-view rather than leaving the app.
export type TopBarHeader = { title: string; back?: { label: string; onBack: () => void } }

// What the bar draws. The handler is deliberately not part of it: a screen
// hands over a fresh closure on every render, and re-rendering the shell for
// that would be a loop. It is kept in a ref and read when it is needed.
type View = { title: string; backLabel: string | null }

export const TopBarContext = createContext<(header: TopBarHeader) => void>(() => {})

// Called by every screen and sub-view. Null means "not mine": the screen has
// handed the bar to something it is rendering in its own place, and setting it
// here as well would race that child's call.
export function useTopBar(header: TopBarHeader | null) {
  const register = useContext(TopBarContext)
  const title = header?.title
  const label = header?.back?.label
  const onBack = header?.back?.onBack
  useEffect(() => {
    if (title === undefined) return
    if (label === undefined || onBack === undefined) register({ title })
    else register({ title, back: { label, onBack } })
  }, [register, title, label, onBack])
}

// The bar's own state, held once at the top of the app.
//
// The history rule in one line: a sub-view is worth one entry, and going a
// level deeper is worth another. Every back press, whether it comes from the
// bar or from the browser, pops one of them and runs the handler the screen on
// top registered. Entries the app pushed and no longer needs are wound back in
// rather than left for somebody to press through.
export function useTopBarState() {
  // The app opens on the dashboard, so that is what the bar says before the
  // first screen has had its say.
  const [view, setView] = useState<View>({ title: 'Dashboard', backLabel: null })
  const viewRef = useRef(view)
  const backRef = useRef<(() => void) | null>(null)
  // Entries this app pushed and has not spent.
  const depth = useRef(0)
  // Pops the app asked for itself, which must not be answered as if somebody
  // had pressed back.
  const ours = useRef(0)
  // A press is being answered and the screen has not settled yet.
  const popping = useRef(false)

  const unwind = () => {
    const spent = depth.current
    depth.current = 0
    // A jump of several entries is one traversal and announces itself once,
    // however far back it goes, so this counts the call and not the entries.
    ours.current += 1
    window.history.go(-spent)
  }

  const register = useCallback((header: TopBarHeader) => {
    backRef.current = header.back?.onBack ?? null
    const next: View = { title: header.title, backLabel: header.back?.label ?? null }
    const prev = viewRef.current
    if (prev.title === next.title && prev.backLabel === next.backLabel) return
    viewRef.current = next
    setView(next)

    const answered = popping.current
    popping.current = false
    if (next.backLabel === null) {
      // A top-level screen. Anything still pushed belongs to a sub-view that
      // has been left some other way than by pressing back.
      if (depth.current > 0) unwind()
      return
    }
    // A level deeper is a new entry. The same level with a new title is not:
    // a food's name arriving after the screen it is on would otherwise buy a
    // second entry for one screen.
    if (!answered && next.backLabel !== prev.backLabel) {
      window.history.pushState({ sub: next.backLabel }, '')
      depth.current += 1
    }
  }, [])

  useEffect(() => {
    const onPop = () => {
      if (ours.current > 0) {
        ours.current -= 1
        return
      }
      if (popping.current) {
        // Back pressed twice before the first press had landed. The entry is
        // gone either way, so it is counted and the screen keeps closing once.
        if (depth.current > 0) depth.current -= 1
        return
      }
      const back = backRef.current
      if (back === null) {
        // Nothing on screen to close. The app was opened here, or every entry
        // it pushed has been spent, and leaving is what back means.
        depth.current = 0
        return
      }
      if (depth.current > 0) depth.current -= 1
      popping.current = true
      back()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // The bar's own control goes through history rather than straight to the
  // handler, so it and the browser's back button leave the same stack behind.
  const goBack = useCallback(() => {
    if (depth.current > 0) window.history.back()
    else backRef.current?.()
  }, [])

  return {
    title: view.title,
    backLabel: view.backLabel,
    hasBack: view.backLabel !== null,
    register,
    goBack,
  }
}
