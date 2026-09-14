// The calendar's own vocabulary: the eight colours a shared calendar can wear,
// the month grid the page draws, and the times it writes.
//
// backend/app/calendar_colors.py holds the same eight keys in the same order. A
// calendar carries the key and the stylesheet decides what it looks like, so a
// row never holds a colour from a theme that has moved on.

import type { Clock } from './clock'

export type PaletteKey =
  | 'blue'
  | 'violet'
  | 'orange'
  | 'coral'
  | 'gold'
  | 'teal'
  | 'pink'
  | 'slate'

export const PALETTE: { key: PaletteKey; label: string; token: string }[] = [
  { key: 'blue', label: 'Blue', token: 'var(--blue)' },
  { key: 'violet', label: 'Violet', token: 'var(--violet)' },
  { key: 'orange', label: 'Orange', token: 'var(--orange)' },
  { key: 'coral', label: 'Coral', token: 'var(--coral)' },
  { key: 'gold', label: 'Gold', token: 'var(--gold)' },
  { key: 'teal', label: 'Teal', token: 'var(--cal-teal)' },
  { key: 'pink', label: 'Pink', token: 'var(--cal-pink)' },
  { key: 'slate', label: 'Slate', token: 'var(--cal-slate)' },
]

// What an entry nobody shared wears: the app's own green, the same accent the
// rest of Tare is drawn in.
export const PERSONAL = 'var(--accent)'

// The colour of a calendar key, or the personal green for anything that is on
// no shared calendar and for a key this build has never heard of.
export function colorToken(key: string | null | undefined): string {
  return PALETTE.find((one) => one.key === key)?.token ?? PERSONAL
}

const pad = (value: number): string => String(value).padStart(2, '0')

export const isoFrom = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`

// One day of the grid: which day it is, the number drawn in the corner, and
// whether it belongs to a neighbouring month.
export type GridDay = { date: string; day: number; spillover: boolean }

// Six weeks of seven days, Sunday first, always the same shape so the grid
// does not change height from month to month. Built on UTC parts: a local
// midnight is not a fixed thing in a zone whose clocks move at midnight.
export function monthGrid(year: number, month: number): GridDay[][] {
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const weeks: GridDay[][] = []
  for (let week = 0; week < 6; week += 1) {
    const days: GridDay[] = []
    for (let column = 0; column < 7; column += 1) {
      const at = new Date(Date.UTC(year, month - 1, 1 + week * 7 + column - lead))
      days.push({
        date: isoFrom(at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate()),
        day: at.getUTCDate(),
        spillover: at.getUTCMonth() + 1 !== month || at.getUTCFullYear() !== year,
      })
    }
    weeks.push(days)
  }
  return weeks
}

// The year and month a date is in, read off the string rather than parsed into
// a Date, so no zone can push it onto its neighbour.
export function monthOf(iso: string): { year: number; month: number } {
  const [year, month] = iso.split('-').map(Number)
  return { year, month }
}

export function shiftMonth(
  year: number,
  month: number,
  step: number
): { year: number; month: number } {
  const at = new Date(Date.UTC(year, month - 1 + step, 1))
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1 }
}

// "September 2026", for the header over the grid.
export function monthTitle(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  })
}

// "14:30" as minutes past midnight, which is what the timeline measures in.
export function minutesOf(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

// What time it is where the account says it is, in the same minutes. The
// device's own clock is the fallback for a zone this browser never heard of.
export function nowMinutesIn(timezone: string): number {
  const now = new Date()
  try {
    const text = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(now)
    return minutesOf(text)
  } catch {
    return now.getHours() * 60 + now.getMinutes()
  }
}

// A stored "HH:MM" in the words the account reads times in. Twelve-hour times
// are tightened the way lib/clock.ts writes one, so 2:30PM reads the same
// wherever it is drawn.
export function formatTime(value: string, clock: Clock): string {
  const [hour, minute] = value.split(':').map(Number)
  if (clock === '24h') return `${pad(hour)}:${pad(minute)}`
  const shown = hour % 12 === 0 ? 12 : hour % 12
  return `${shown}:${pad(minute)}${hour < 12 ? 'AM' : 'PM'}`
}

// The whole slot: "3:00 to 4:30PM", or "11:30AM to 1:00PM" across noon. The
// start drops its half of the day when the end shares it, so a short slot
// stays short.
export function formatTimeRange(start: string, end: string | null, clock: Clock): string {
  const from = formatTime(start, clock)
  if (end === null || end === '') return from
  const to = formatTime(end, clock)
  if (clock === '24h') return `${from} to ${to}`
  return `${from.slice(-2) === to.slice(-2) ? from.slice(0, -2) : from} to ${to}`
}

// The label down the timeline's gutter: 6 AM, noon, 11 PM.
export function hourLabel(hour: number, clock: Clock): string {
  if (clock === '24h') return `${pad(hour)}:00`
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`
}
