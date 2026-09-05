// The shape a workout drew, as one line.
//
// Not a map. There is no tile server, no library and no request to anybody
// else: the points are already on the page, and a line through them says where
// the session went without telling a third party that it happened. Both ends
// were thrown away before the points were ever stored, so the line never
// starts at a door.

import { useEffect, useMemo, useRef, type RefObject } from 'react'

import { alongRoute, pathOf, spotAt, spotsBetween, type Spot } from '../lib/route'

// The drawing at the top of the screen, and the strip that rides beside the
// graph's readout further down it.
const FULL_BOX: [number, number] = [320, 180]
const COMPACT_BOX: [number, number] = [96, 64]

// Room kept on all four sides, as a share of the shorter one, so the small
// strip has the same breathing room as the drawing.
const MARGIN_SHARE = 0.06

// The cursor's dot, in screen pixels. The drawing is stretched to whatever
// width it is given, so the radius is worked out from that stretch each time
// the dot moves and it reads the same size on the strip and on the wide
// drawing alike.
const DOT_PX = 11
const DOT_EDGE_PX = 15

// A way to put a dot on the line and take it off again, handed to whoever is
// driving it. The graph's cursor moves per pointer event, so this writes
// attributes on the circle rather than rendering: a render a frame is not what
// React is for.
export interface RouteMarker {
  at: (part: number) => void
  clear: () => void
}

// Flat coordinates scaled to fit the box and centred in it, never stretched:
// the shape is the point. A degree of longitude is shorter than a degree of
// latitude everywhere but the equator, so it is scaled by the cosine of the
// working latitude. Without that a north-south run reads as a wide sprawl.
function fitted(
  points: [number, number][],
  width: number,
  height: number
): Spot[] | null {
  if (points.length < 2) return null
  const lats = points.map(([lat]) => lat)
  const lons = points.map(([, lon]) => lon)
  const north = Math.max(...lats)
  const south = Math.min(...lats)
  const east = Math.max(...lons)
  const west = Math.min(...lons)

  const scale = Math.cos(((north + south) / 2) * (Math.PI / 180))
  const spanX = Math.max((east - west) * scale, 1e-9)
  const spanY = Math.max(north - south, 1e-9)
  const margin = Math.min(width, height) * MARGIN_SHARE
  const room = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY)
  const offsetX = (width - spanX * room) / 2
  const offsetY = (height - spanY * room) / 2

  // Screens count downward and the world counts north upward.
  return points.map(([lat, lon]): Spot => [
    offsetX + (lon - west) * scale * room,
    offsetY + (north - lat) * room,
  ])
}

export function RouteLine({
  points,
  compact = false,
  highlight = null,
  marker,
}: {
  points: [number, number][]
  // Set for the strip beside the readout, which is a small box held to its own
  // height rather than the width of the card.
  compact?: boolean
  // The stretch to pick out, as two shares of the way along the line. A tapped
  // split sets it; nothing else passes one.
  highlight?: { from: number; to: number } | null
  // Filled in with a way to move the dot, for as long as there is a line to
  // move it along.
  marker?: RefObject<RouteMarker | null>
}) {
  const [width, height] = compact ? COMPACT_BOX : FULL_BOX
  const dot = useRef<SVGGElement>(null)
  const spots = useMemo(() => fitted(points, width, height), [points, width, height])
  const walked = useMemo(() => alongRoute(points), [points])

  useEffect(() => {
    if (marker === undefined) return
    marker.current = {
      at(part: number) {
        const spot = spots === null ? null : spotAt(spots, walked, part)
        if (spot === null || dot.current === null) return
        const drawn = dot.current.ownerSVGElement?.getBoundingClientRect().width ?? width
        const scale = drawn > 0 ? width / drawn : 1
        const [edge, core] = dot.current.querySelectorAll('circle')
        edge?.setAttribute('r', ((DOT_EDGE_PX / 2) * scale).toFixed(2))
        core?.setAttribute('r', ((DOT_PX / 2) * scale).toFixed(2))
        dot.current.setAttribute('transform', `translate(${spot[0].toFixed(1)} ${spot[1].toFixed(1)})`)
        dot.current.setAttribute('visibility', 'visible')
      },
      clear() {
        dot.current?.setAttribute('visibility', 'hidden')
      },
    }
    return () => {
      marker.current = null
    }
  }, [marker, spots, walked, width])

  if (spots === null) return null

  // The stretch a tapped split covers: a casing in the card's own colour under
  // it, so the trail reads as laid over the line rather than mixed into it.
  const stretch =
    highlight === null
      ? ''
      : pathOf(spotsBetween(spots, walked, highlight.from, highlight.to))

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={compact ? 'h-12 w-18 shrink-0' : 'w-full'}
      role={compact ? undefined : 'img'}
      aria-hidden={compact || undefined}
      aria-label={compact ? undefined : "The shape of this workout's route"}
    >
      <polyline
        className="t-stroke"
        points={pathOf(spots)}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {stretch !== '' && (
        <>
          <polyline
            className="t-stroke"
            points={stretch}
            fill="none"
            stroke="var(--surface)"
            strokeWidth={7}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            className="t-stroke"
            points={stretch}
            fill="none"
            stroke="var(--orange)"
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {marker !== undefined && (
        <g ref={dot} visibility="hidden">
          <circle r={DOT_EDGE_PX / 2} fill="var(--surface)" />
          <circle r={DOT_PX / 2} fill="var(--orange)" />
        </g>
      )}
    </svg>
  )
}
