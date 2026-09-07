// Which ground the app is drawn on. Kept per browser rather than per account:
// a phone in bed at night and a desktop by a window are not the same room, and
// one account is used from both. The choice is written onto the root element,
// where the stylesheet's light block looks for it, and it has to be there
// before anything renders, so main.tsx imports this module first.

import { useSyncExternalStore } from 'react'

const THEME_KEY = 'tare.theme'

export type Theme = 'light' | 'dark'

// Dark is the default and the fallback. A browser with storage turned off, one
// that has never been asked, or one holding a value that is not ours all open
// on dark rather than on a guess.
function rememberedTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function rememberTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Nothing to say: the choice holds for this visit and is forgotten after.
  }
}

// What the browser paints its own chrome with, kept in step with --bg by hand:
// a meta tag cannot read a custom property, so the values live here too.
const CHROME: Record<Theme, string> = {
  dark: '#101312',
  light: '#f7f4ec',
}

let current: Theme = rememberedTheme()
const watchers = new Set<() => void>()

export function applyTheme(theme: Theme): void {
  current = theme
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
  for (const watcher of watchers) watcher()
}

function watch(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

// For anything that has to redraw when the ground moves under it. Every way of
// changing the theme goes through applyTheme, so this cannot drift from what
// the root element says.
export function useTheme(): Theme {
  return useSyncExternalStore(watch, () => current)
}

applyTheme(current)
