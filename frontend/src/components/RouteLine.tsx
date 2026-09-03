// The shape a workout drew, as one path.
//
// Not a map. There is no tile server, no library and no request to anybody
// else: the points are already on the page, and a line through them says where
// the session went without telling a third party that it happened. Both ends
// were thrown away before the points were ever stored, so the line never
// starts at a door.

const WIDTH = 320
const HEIGHT = 180
const PADDING = 10

export function RouteLine({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null

  const lats = points.map(([lat]) => lat)
  const lons = points.map(([, lon]) => lon)
  const north = Math.max(...lats)
  const south = Math.min(...lats)
  const east = Math.max(...lons)
  const west = Math.min(...lons)

  // A degree of longitude is shorter than a degree of latitude everywhere but
  // the equator, so it is scaled by the cosine of the working latitude. Without
  // this a north-south run reads as a wide sprawl.
  const scale = Math.cos(((north + south) / 2) * (Math.PI / 180))
  const spanX = Math.max((east - west) * scale, 1e-9)
  const spanY = Math.max(north - south, 1e-9)
  const room = Math.min((WIDTH - PADDING * 2) / spanX, (HEIGHT - PADDING * 2) / spanY)
  const offsetX = (WIDTH - spanX * room) / 2
  const offsetY = (HEIGHT - spanY * room) / 2

  const path = points
    .map(([lat, lon], index) => {
      const x = offsetX + (lon - west) * scale * room
      // Screens count downward and the world counts north upward.
      const y = offsetY + (north - lat) * room
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="The shape of this workout's route"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
      />
    </svg>
  )
}
