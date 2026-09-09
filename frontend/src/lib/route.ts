// The arithmetic behind the route line: where a share of the way along it
// falls, and which share of it a minute or a split belongs to.
//
// Nothing here draws anything or asks for anything: the points are already on
// the page. The stored line has 200 m thrown away at each end, so a share of
// the session's distance lands a little early or late on it, which is accepted
// because the ends are hidden on purpose.

import type { WorkoutSample, WorkoutSplit } from '../api'

// One place on a drawing: x and y inside the box the route was fitted into.
export type Spot = [number, number]

const RADIANS = Math.PI / 180

// A run of spots written the way an SVG polyline reads its points.
export const pathOf = (spots: Spot[]): string =>
  spots.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

// How far apart two points are, as the angle between them at the centre of the
// earth. It is only ever read as a share of a whole line below, so the radius
// that would turn it into metres cancels and is never written down.
function apart([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const halfLat = ((lat2 - lat1) * RADIANS) / 2
  const halfLon = ((lon2 - lon1) * RADIANS) / 2
  const chord =
    Math.sin(halfLat) ** 2 +
    Math.cos(lat1 * RADIANS) * Math.cos(lat2 * RADIANS) * Math.sin(halfLon) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(chord)))
}

// How far along the line each point sits, as a share of the whole: nought at
// the first and one at the last. This is what lets a stretch of a session,
// measured in miles, be found on a line that is only ever measured in itself.
export function alongRoute(points: [number, number][]): number[] {
  const walked = [0]
  let total = 0
  for (let step = 1; step < points.length; step += 1) {
    total += apart(points[step - 1], points[step])
    walked.push(total)
  }
  return total > 0 ? walked.map((far) => far / total) : walked.map(() => 0)
}

// The place a share of the way along the line falls, worked out between the two
// points it lands between. Shares off either end are held to that end.
export function spotAt(spots: Spot[], walked: number[], part: number): Spot | null {
  if (spots.length === 0) return null
  if (spots.length < 2) return spots[0]
  const want = Math.min(1, Math.max(0, part))
  let step = 1
  while (step < walked.length - 1 && walked[step] < want) step += 1
  const span = walked[step] - walked[step - 1]
  const share = span > 0 ? (want - walked[step - 1]) / span : 0
  const [fromX, fromY] = spots[step - 1]
  const [toX, toY] = spots[step]
  return [fromX + (toX - fromX) * share, fromY + (toY - fromY) * share]
}

// The stretch of line between two shares of the way along it: the two ends
// worked out where they fall, and every point of the line between them kept as
// it is.
export function spotsBetween(
  spots: Spot[],
  walked: number[],
  from: number,
  to: number
): Spot[] {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const head = spotAt(spots, walked, start)
  const tail = spotAt(spots, walked, end)
  if (head === null || tail === null) return []
  return [head, ...spots.filter((_, at) => walked[at] > start && walked[at] < end), tail]
}

// How far along the session each minute had come by the middle of it, as a
// share of the whole. The graph names a minute at its middle, so the dot on the
// line stands where the session was halfway through that minute.
export function placesOf(samples: WorkoutSample[]): Map<number, number> {
  const covered = (row: WorkoutSample) => Math.max(0, row.distance_m ?? 0)
  const total = samples.reduce((sum, row) => sum + covered(row), 0)
  const places = new Map<number, number>()
  if (!(total > 0)) return places
  let far = 0
  for (const row of samples) {
    places.set(row.minute, (far + covered(row) / 2) / total)
    far += covered(row)
  }
  return places
}

// Where each split begins and ends, as shares of the distance the session
// covered. The route is one line and a split is a stretch of miles, so a split
// is found on the line by how far along the session it fell.
export function spansOf(splits: WorkoutSplit[]): { from: number; to: number }[] {
  const total = splits.reduce((sum, split) => sum + split.distance_m, 0)
  if (!(total > 0)) return splits.map(() => ({ from: 0, to: 0 }))
  let far = 0
  return splits.map((split) => {
    const from = far / total
    far += split.distance_m
    return { from, to: far / total }
  })
}
