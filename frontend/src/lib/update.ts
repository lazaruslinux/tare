import { useSyncExternalStore } from 'react'

// Whether a new build is sitting there waiting, and how to take it. The
// service worker is registered in main.tsx, which hands the update function
// here, so the bar that offers it is a plain component with no worker in it.

let waiting = false
let take: (() => void) | null = null
const listeners = new Set<() => void>()

function told() {
  for (const listener of listeners) listener()
}

export function updateReady(apply: () => void) {
  take = apply
  waiting = true
  told()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useNeedRefresh(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => waiting,
    () => false
  )
}

// Applying it reloads the page, so there is nothing to put back afterwards.
export function reload() {
  take?.()
}
