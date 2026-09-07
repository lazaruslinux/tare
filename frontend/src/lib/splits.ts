import type { WorkoutSample } from '../api'
import { distanceIn, M_PER_MILE } from './units'

// One whole mile or kilometre of a session, and what it took.
export type Split = {
  // 1 for the first, 2 for the second, and so on.
  index: number
  // How far this one covered, in metres. A full unit for every split but the
  // last.
  distance: number
  // Kept unrounded, so the splits of a session still add up to the session.
  seconds: number
  // The average of whatever heart rate readings landed inside it, or null.
  hr: number | null
  // Whether it is a whole one. The last split of a session usually is not.
  whole: boolean
}

// A phone writes one row a minute and numbers the rows from the start, so a
// minute is the whole of the timing there is to work from.
const MINUTE_S = 60

// The floor a split's bar never goes under, so the slowest split of a session
// still reads as a bar rather than as nothing at all.
const SPLIT_FLOOR = 30

// One mile or one kilometre, in the metres everything is stored in.
export const stepOf = (units: 'imperial' | 'metric'): number =>
  units === 'metric' ? 1000 : M_PER_MILE

/** The splits of a session, out of its per-minute rows.
 *
 * The minutes are added up rather than read as a running total, because a row
 * is a wall-clock minute and the session's own duration leaves out the minutes
 * it paused for without saying which ones. A minute that carries a boundary is
 * divided at it, in the proportion its distance was, which is the best a
 * per-minute export can say about where a mile ended.
 */
export function splitsOf(samples: WorkoutSample[], units: 'imperial' | 'metric'): Split[] {
  const step = stepOf(units)
  const moved = (row: WorkoutSample): boolean =>
    (row.distance_m ?? 0) > 0 || (row.steps ?? 0) > 0
  const moving = samples.filter(moved)
  const lastMoving = moving[moving.length - 1]
  const beforeLast = moving[moving.length - 2]
  const splits: Split[] = []
  let covered = 0
  let seconds = 0
  let beats = 0
  let beatSeconds = 0

  for (const row of samples) {
    let left = Math.max(0, row.distance_m ?? 0)
    // A minute that recorded movement counts whole; one that recorded none
    // adds nothing, being a pause or a reading stamped after the finish.
    let time = moved(row) ? MINUTE_S : 0
    // A session rarely ends on the stroke of a minute, so the last moving one
    // takes the share its distance suggests against the minute before it.
    if (row === lastMoving && beforeLast !== undefined && (beforeLast.distance_m ?? 0) > 0) {
      time = Math.min(MINUTE_S, MINUTE_S * (left / (beforeLast.distance_m ?? 1)))
    }
    const hr = row.hr_avg ?? row.hr_max ?? row.hr_min

    while (left > 0 && covered + left >= step) {
      const part = step - covered
      const took = time * (part / left)
      seconds += took
      if (hr !== null && hr !== undefined) {
        beats += hr * took
        beatSeconds += took
      }
      splits.push({
        index: splits.length + 1,
        distance: step,
        seconds,
        hr: beatSeconds > 0 ? Math.round(beats / beatSeconds) : null,
        whole: true,
      })
      covered = 0
      seconds = 0
      beats = 0
      beatSeconds = 0
      left -= part
      time -= took
    }

    covered += left
    seconds += time
    if (hr !== null && hr !== undefined) {
      beats += hr * time
      beatSeconds += time
    }
  }

  // Whatever the session ended part way through, at the distance it actually
  // reached rather than rounded up to a mile nobody ran. A tail shorter than a
  // hundredth of a unit is left off: it is the smallest thing the row could
  // print, and a split reading 0.00 is not a split.
  if (covered >= step / 100 && seconds > 0) {
    splits.push({
      index: splits.length + 1,
      distance: covered,
      seconds,
      hr: beatSeconds > 0 ? Math.round(beats / beatSeconds) : null,
      whole: false,
    })
  }
  return splits
}

// How long one split took per mile or kilometre, which is what the bars are
// scaled on: fewer seconds is quicker, whichever way the pace is written.
export function secondsPerUnit(split: Split, units: 'imperial' | 'metric'): number {
  const covered = distanceIn(split.distance, units)
  return covered > 0 ? split.seconds / covered : 0
}

// The quickest whole split of the session, or null where there are fewer than
// two whole ones. The tail is never it: a finish two tenths long is quicker per
// mile than any mile of the session on most runs, and calling that the fastest
// mile would name a mile nobody ran. One split on its own is not a comparison
// either, so it is left unmarked.
export function fastestSplit(
  splits: Split[],
  units: 'imperial' | 'metric'
): Split | null {
  const whole = splits.filter((split) => split.whole)
  if (whole.length < 2) return null
  return whole.reduce((best, split) =>
    secondsPerUnit(split, units) < secondsPerUnit(best, units) ? split : best
  )
}

// Where one split sits in the range this session actually ran: the quickest
// fills its row, the slowest keeps the floor, and everything between is spread
// evenly across the gap. Measuring every bar against the quickest alone made a
// steady session read as identical full bars, because five miles within four
// seconds of each other are almost exactly one another. A session with one
// split, or with every split inside a second of the rest, has no range to
// spread over and every bar is full.
export function splitShare(pace: number, fastest: number, slowest: number): number {
  if (!(pace > 0) || !(slowest - fastest >= 1)) return 100
  return 100 - (100 - SPLIT_FLOOR) * ((pace - fastest) / (slowest - fastest))
}
