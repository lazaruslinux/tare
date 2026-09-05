// The same route, on a map, where the instance has the basemap installed.
//
// This file and the module under it are chunks of their own: nothing loads a
// renderer until the archive has already answered that it is there. Without it
// the card keeps the drawn line and none of this is ever fetched.

import { useEffect, useRef, useState, type RefObject } from 'react'

import { corners, MapLibreMap, setMark, setTrail, styleFor } from '../lib/mapgl'
import { useTheme } from '../theme'
import type { RouteMarker } from './RouteLine'
import { Sheet } from './Sheet'

type Span = { from: number; to: number } | null

// One map in one box. The card's is not interactive, because a map that pans
// under a thumb on a scrolling page is a map nobody asked to open; the one in
// the sheet is, because the sheet is what opening it was for.
function MapCanvas({
  points,
  highlight,
  marker,
  interactive,
  className,
}: {
  points: [number, number][]
  highlight: Span
  // Filled in with a way to move the dot, the same shape the drawing hands
  // back, so the graph's cursor drives either one without knowing which.
  marker?: RefObject<RouteMarker | null>
  interactive: boolean
  className: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const theme = useTheme()
  // The ground the style on the map was built for, so a theme change is told
  // apart from a first render.
  const built = useRef(theme)
  // What the overlays are showing, kept here as well as in props: a style
  // swapped for the other ground comes back empty and both are put back on it.
  const span = useRef<Span>(highlight)
  const placed = useRef<number | null>(null)

  useEffect(() => {
    const holder = box.current
    if (holder === null) return
    const drawn = new MapLibreMap({
      container: holder,
      style: styleFor(built.current, points),
      bounds: corners(points),
      fitBoundsOptions: { padding: 24, animate: false },
      attributionControl: { compact: true },
      interactive,
    })
    map.current = drawn
    drawn.once('load', () => {
      setTrail(drawn, points, span.current)
      setMark(drawn, points, placed.current)
    })
    return () => {
      map.current = null
      drawn.remove()
    }
  }, [points, interactive])

  useEffect(() => {
    span.current = highlight
    const drawn = map.current
    if (drawn !== null) setTrail(drawn, points, highlight)
  }, [highlight, points])

  useEffect(() => {
    const drawn = map.current
    if (drawn === null || built.current === theme) return
    built.current = theme
    drawn.setStyle(styleFor(theme, points))
    drawn.once('style.load', () => {
      setTrail(drawn, points, span.current)
      setMark(drawn, points, placed.current)
    })
  }, [theme, points])

  useEffect(() => {
    if (marker === undefined) return
    marker.current = {
      at(part: number) {
        placed.current = part
        const drawn = map.current
        if (drawn !== null) setMark(drawn, points, part)
      },
      clear() {
        placed.current = null
        const drawn = map.current
        if (drawn !== null) setMark(drawn, points, null)
      },
    }
    return () => {
      marker.current = null
    }
  }, [marker, points])

  return <div ref={box} className={className} />
}

export default function RouteMap({
  points,
  highlight = null,
  marker,
}: {
  points: [number, number][]
  highlight?: Span
  marker?: RefObject<RouteMarker | null>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* A map in a card is a picture of the route. Tapping it is what asks
          for a map to move around in, and the credit control underneath is the
          one thing in here that is not part of that tap. */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Open the map"
        className="h-48 cursor-pointer overflow-hidden rounded-lg min-[900px]:h-64"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('.maplibregl-ctrl') === null) setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <MapCanvas
          points={points}
          highlight={highlight}
          marker={marker}
          interactive={false}
          className="h-full w-full"
        />
      </div>
      <Sheet open={open} label="Route map" full onClose={() => setOpen(false)}>
        {/* Plain gestures inside: the sheet is modal, so a drag here cannot
            take the page behind it with it. */}
        <MapCanvas
          points={points}
          highlight={highlight}
          interactive
          className="min-h-0 w-full flex-1 overflow-hidden rounded-lg"
        />
        <p className="mt-2 text-xs text-muted">Start and end areas hidden</p>
        <button type="button" className="t-btn mt-3 w-full" onClick={() => setOpen(false)}>
          Close
        </button>
      </Sheet>
    </>
  )
}
