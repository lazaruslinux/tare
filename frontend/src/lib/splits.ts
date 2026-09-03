import type { WorkoutSample } from '../api'

// One whole mile or kilometre of a session, and what it took.
export type Split = {
  // 1 for the first, 2 for the second, and so on.
  index: number
  // How far this one covered. A full unit for every split but the last.
  distance: number
  seconds: number
  // The average of whatever heart rate readings landed inside it, or null.
  hr: number | null
  // Whether it is a whole one. The last split of a session usually is not.
  whole: boolean
}

const M_PER_MILE = 1609.344

/** The splits of a session, out of its per-minute rows.
 *
 * Each minute row says how far that minute covered, so the boundaries fall
 * inside minutes rather than on them: a mile finishes somewhere in the middle
 * of the ninth minute, and the time is shared out across the minute in
 * proportion to the distance, which is the best a minute-resolution export can
 * say. A session with no distance at all has no splits, which is the honest
 * answer for a swim on a watch that measured only the heart.
 */
export function splitsOf(
  samples: WorkoutSample[],
  units: 'imperial' | 'metric'
): Split[] {
  const step = units === 'metric' ? 1000 : M_PER_MILE
  const rows = samples.filter((row) => (row.distance_m ?? 0) > 0)
  if (rows.length === 0) return []

  const splits: Split[] = []
  let covered = 0
  let seconds = 0
  let beats: number[] = []

  for (const row of rows) {
    let left = row.distance_m ?? 0
    const rate = 60 / left
    const hr = row.hr_avg ?? row.hr_max ?? row.hr_min
    while (left > 0) {
      const room = step - covered
      const taken = Math.min(room, left)
      covered += taken
      seconds += taken * rate
      if (hr !== null && hr !== undefined) beats.push(hr)
      left -= taken
      if (covered >= step - 0.0001) {
        splits.push({
          index: splits.length + 1,
          distance: step,
          seconds: Math.round(seconds),
          hr: beats.length === 0 ? null : Math.round(beats.reduce((a, b) => a + b, 0) / beats.length),
          whole: true,
        })
        covered = 0
        seconds = 0
        beats = []
      }
    }
  }

  // Whatever is left over is the last, partial split. Shown, because a run that
  // ends at 3.4 miles ended at 3.4 miles.
  if (covered > 0) {
    splits.push({
      index: splits.length + 1,
      distance: covered,
      seconds: Math.round(seconds),
      hr: beats.length === 0 ? null : Math.round(beats.reduce((a, b) => a + b, 0) / beats.length),
      whole: false,
    })
  }
  return splits
}
