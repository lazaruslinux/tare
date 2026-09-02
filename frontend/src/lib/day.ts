// Which day it is where the account says it is, and which meal a thing logged
// now most likely belongs to.
//
// The client always tells the server which day it means. This is how it decides
// what to say: the account's own zone, the same one the server would fall back
// to, so the day on screen and the day in the database are never two days.

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack']

export const SLOT_LABEL: Record<Slot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
}

// When one meal stops being the likely answer and the next one starts. Nobody
// is right about this for everybody; it only has to be right often enough that
// the picker opens on the meal somebody meant.
const BREAKFAST_UNTIL = 11
const LUNCH_UNTIL = 15
const DINNER_UNTIL = 20

// en-CA is the one widely supported locale that writes a date the way the API
// does, so no month names have to be parsed back out.
function inZone(timezone: string, when: Date): { day: string; hour: number } {
  try {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(when)
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(when)
    return { day, hour: Number(hour) }
  } catch {
    // A zone this browser has never heard of, or a stored one that no longer
    // exists. The device's own is the next best answer, and it is the one the
    // person is actually standing in.
    return { day: when.toLocaleDateString('en-CA'), hour: when.getHours() }
  }
}

export const today = (timezone: string): string => inZone(timezone, new Date()).day

export function slotByTime(timezone: string): Slot {
  const { hour } = inZone(timezone, new Date())
  if (hour < BREAKFAST_UNTIL) return 'breakfast'
  if (hour < LUNCH_UNTIL) return 'lunch'
  if (hour < DINNER_UNTIL) return 'dinner'
  return 'snack'
}

// A day either side. Read as UTC so a day is always twenty-four hours: doing
// this in local time lands on the same date twice when the clocks go back.
export function shiftDay(iso: string, days: number): string {
  const at = new Date(`${iso}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

export function dayLabel(iso: string, todayIso: string): string {
  if (iso === todayIso) return 'Today'
  if (iso === shiftDay(todayIso, -1)) return 'Yesterday'
  if (iso === shiftDay(todayIso, 1)) return 'Tomorrow'
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}
