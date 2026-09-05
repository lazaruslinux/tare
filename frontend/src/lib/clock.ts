// What time it is, in the words the account asked for. Twelve hours by
// default, because that is what the people here read; twenty-four is the
// option for whoever prefers it.
//
// Held in a module store rather than passed down, the way the theme is: a
// timestamp is drawn in a dozen places and none of them wants a preference
// threaded through it. Every time is stored in UTC either way, so this only
// ever changes what a string looks like.

import { useSyncExternalStore } from 'react'

export type Clock = '12h' | '24h'

let current: Clock = '12h'
const watchers = new Set<() => void>()

// Called wherever the account is set. Same value twice is a no-op, so the
// screens that set it on every read do not redraw for nothing.
export function setClock(clock: Clock): void {
  if (clock === current) return
  current = clock
  for (const watcher of watchers) watcher()
}

function watch(watcher: () => void): () => void {
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
  }
}

// For anything that has to redraw when the preference moves under it. The
// formatters below read the store rather than take an argument, so a component
// that renders one has to say it cares.
export function useClock(): Clock {
  return useSyncExternalStore(watch, () => current)
}

// Twelve-hour times read 5:53AM, with nothing between the minutes and the
// mark. Intl puts a space there, and some builds put a narrow one.
const tightened = (text: string): string => text.replace(/\s+(?=[AP]M$)/i, '')

export function clockText(iso: string, timezone?: string): string {
  const at = new Date(iso)
  // h23 rather than h24: h24 writes midnight as 24:00, which reads as
  // tomorrow.
  const options: Intl.DateTimeFormatOptions =
    current === '24h'
      ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
      : { hour: 'numeric', minute: '2-digit', hour12: true }
  try {
    return tightened(
      at.toLocaleTimeString(undefined, timezone === undefined ? options : { ...options, timeZone: timezone })
    )
  } catch {
    // A zone this browser has never heard of. The device's own is the next
    // best answer, and it is the one the person is standing in.
    return tightened(at.toLocaleTimeString(undefined, options))
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function spelled(at: Date, timezone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  }).formatToParts(at)
  const of = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${of('weekday').toUpperCase()} ${of('month')}/${of('day')}/${of('year')}`
}

export function dateText(iso: string, timezone?: string): string {
  // A day with no time in it is read as UTC, the way lib/day.ts reads one, so
  // a date is never pushed onto its neighbour by the zone it is drawn in.
  const bare = DATE_ONLY.test(iso)
  const at = new Date(bare ? `${iso}T00:00:00Z` : iso)
  const zone = bare ? 'UTC' : timezone
  try {
    return spelled(at, zone)
  } catch {
    return spelled(at, undefined)
  }
}

// A moment written out whole, in the device's own zone: WED 9/2/26 5:53AM.
export const stampText = (iso: string): string => `${dateText(iso)} ${clockText(iso)}`
