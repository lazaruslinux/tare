// The time zones tare offers, in the order the Display screen lists them.
//
// The mirror of the backend's security.US_ZONES, and it has to stay one: the
// server refuses anything else. A short list somebody reads through rather
// than the browser's whole zone database, which is six hundred names nobody
// wants to search for their own.

export const ZONES: { value: string; label: string }[] = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
]

export const offList = (zone: string): boolean =>
  !ZONES.some((row) => row.value === zone)
