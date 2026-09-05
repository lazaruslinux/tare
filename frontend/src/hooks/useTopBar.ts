import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

import type { Role } from '../api'

// What the bar says for the screen that is on.
//
// A back means the screen is a sub-view: the bar draws the control, and the
// browser gets an entry so its own back button closes the sub-view rather than
// leaving the app. Everything else describes a top-level screen's own header,
// because each tab wears a different one.
export type TopBarHeader = {
  title: string
  back?: { label: string; onBack: () => void }
  // How the left slot reads on a top-level screen. The wordmark gives way to
  // the title at rail width, where the rail carries the name instead.
  left?: 'wordmark' | 'title'
  // A quiet line under a large title.
  subtitle?: string
  // The shield beside that line, where it names a person with a role.
  subtitleRole?: Role
  // The day chooser, which is the whole of the Journal's header. The title is
  // the day it names, and tapping it comes back to today.
  pager?: { atToday: boolean; onStep: (days: number) => void; onToday: () => void }
  // The one button on the right. A plus everywhere it appears so far.
  action?: { label: string; onAct: () => void }
  // The Journal's completion check, which sits to the left of the plus. Done
  // is the filled state, and tapping it is what opens or closes the day.
  mark?: { done: boolean; label: string; onToggle: () => void }
}

// What the bar draws. The handlers are deliberately not part of it: a screen
// hands over fresh closures on every render, and re-rendering the shell for
// that would be a loop. They are kept in a ref and read when they are needed.
export type TopBarView = {
  kind: 'back' | 'wordmark' | 'title' | 'pager'
  title: string
  backLabel: string | null
  subtitle: string | null
  subtitleRole: Role
  // Whether the next-day step has anywhere to go. True on anything but a pager.
  atToday: boolean
  // The right-hand button's name, or null for a bar without one.
  action: string | null
  // The check beside it, or null on a bar that has none.
  mark: { done: boolean; label: string } | null
}

type Handlers = {
  back: (() => void) | null
  step: ((days: number) => void) | null
  today: (() => void) | null
  act: (() => void) | null
  toggle: (() => void) | null
}

export const TopBarContext = createContext<(header: TopBarHeader) => void>(() => {})

// Called by every screen and sub-view. Null means "not mine": the screen has
// handed the bar to something it is rendering in its own place, and setting it
// here as well would race that child's call.
export function useTopBar(header: TopBarHeader | null) {
  const register = useContext(TopBarContext)
  // Every render, because the handlers are closures over the state the screen
  // has just drawn with: the Journal's steps mean nothing without the day they
  // were built from. Registering is cheap, and the bar only redraws when what
  // it draws has actually changed.
  useEffect(() => {
    if (header !== null) register(header)
  })
}

function same(prev: TopBarView, next: TopBarView): boolean {
  return (
    prev.kind === next.kind &&
    prev.title === next.title &&
    prev.backLabel === next.backLabel &&
    prev.subtitle === next.subtitle &&
    prev.subtitleRole === next.subtitleRole &&
    prev.atToday === next.atToday &&
    prev.action === next.action &&
    prev.mark?.done === next.mark?.done &&
    prev.mark?.label === next.mark?.label
  )
}

// The bar's own state, held once at the top of the app.
//
// The history rule in one line: a sub-view is worth one entry, and going a
// level deeper is worth another. Every back press, whether it comes from the
// bar or from the browser, pops one of them and runs the handler the screen on
// top registered. Entries the app pushed and no longer needs are wound back in
// rather than left for somebody to press through.
export function useTopBarState() {
  // The app opens on the dashboard, so that is what the bar wears before the
  // first screen has had its say.
  const [view, setView] = useState<TopBarView>({
    kind: 'wordmark',
    title: 'Dashboard',
    backLabel: null,
    subtitle: null,
    subtitleRole: null,
    atToday: true,
    action: null,
    mark: null,
  })
  const viewRef = useRef(view)
  const acts = useRef<Handlers>({
    back: null,
    step: null,
    today: null,
    act: null,
    toggle: null,
  })
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
    acts.current = {
      back: header.back?.onBack ?? null,
      step: header.pager?.onStep ?? null,
      today: header.pager?.onToday ?? null,
      act: header.action?.onAct ?? null,
      toggle: header.mark?.onToggle ?? null,
    }
    const next: TopBarView = {
      kind: header.back
        ? 'back'
        : header.pager
          ? 'pager'
          : header.left === 'wordmark'
            ? 'wordmark'
            : 'title',
      title: header.title,
      backLabel: header.back?.label ?? null,
      subtitle: header.subtitle ?? null,
      subtitleRole: header.subtitleRole ?? null,
      atToday: header.pager?.atToday ?? true,
      action: header.action?.label ?? null,
      mark:
        header.mark === undefined
          ? null
          : { done: header.mark.done, label: header.mark.label },
    }
    const prev = viewRef.current
    if (same(prev, next)) return
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
      const back = acts.current.back
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
    else acts.current.back?.()
  }, [])

  const step = useCallback((days: number) => acts.current.step?.(days), [])
  const goToday = useCallback(() => acts.current.today?.(), [])
  const act = useCallback(() => acts.current.act?.(), [])
  const toggleMark = useCallback(() => acts.current.toggle?.(), [])

  return {
    view,
    hasBack: view.backLabel !== null,
    register,
    goBack,
    step,
    goToday,
    act,
    toggleMark,
  }
}
