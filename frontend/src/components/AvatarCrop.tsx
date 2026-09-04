import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react'

import { Sheet } from './Sheet'

// Framing your own picture: drag to move it, pinch or scroll to zoom, and what
// is inside the square is what everybody else sees. The member crops rather
// than the server, so nobody's head ends up outside the box a middle crop
// would have kept.
//
// The maths is one transform. The picture is laid out at its natural size with
// the origin at its top left corner, so what is on screen is the rectangle
// (tx, ty, width * s, height * s), and the piece to export is simply
// (-tx / s, -ty / s, V / s, V / s).

// The square somebody frames in, in css pixels. Wide enough to work with and
// still inside a 390px phone.
const V = 288
// rounded-xl on the 80px avatar is 12px, so 15 percent of the side.
const CORNER = '15%'
const MAX_ZOOM = 8
// What is sent, and the largest the server keeps.
const EXPORT = 512

const NOT_A_PHOTO = 'That file is not a picture this app can read.'
const NO_BLOB = 'Could not prepare that picture.'

type Frame = { s: number; tx: number; ty: number }

export function AvatarCrop({
  file,
  busy,
  failed,
  onCancel,
  onSave,
}: {
  file: File
  // Whether the picture is on its way to the server, which is the one thing
  // this sheet does not know about itself.
  busy: boolean
  failed: string
  onCancel: () => void
  onSave: (blob: Blob) => void
}) {
  const picture = useRef<HTMLImageElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [error, setError] = useState('')
  // Live pointers by id, two of which make a pinch. A ref rather than state:
  // the gesture maths has to read the latest positions inside a move event.
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  // Read as text rather than handed out as a blob address, because the content
  // policy this app is served under takes pictures from itself and from data
  // and from nowhere else.
  useEffect(() => {
    const reader = new FileReader()
    reader.onload = () => setSource(String(reader.result))
    reader.onerror = () => setError(NOT_A_PHOTO)
    reader.readAsDataURL(file)
    return () => reader.abort()
  }, [file])

  const smallest = natural === null ? 1 : V / Math.min(natural.w, natural.h)

  // Every move and every zoom lands inside these bounds, so the square being
  // exported can never fall off the edge of the picture.
  const held = (next: Frame): Frame => {
    if (natural === null) return next
    const s = Math.min(Math.max(next.s, smallest), smallest * MAX_ZOOM)
    return {
      s,
      tx: Math.min(0, Math.max(V - natural.w * s, next.tx)),
      ty: Math.min(0, Math.max(V - natural.h * s, next.ty)),
    }
  }

  const onLoad = () => {
    const image = picture.current
    if (image === null) return
    const w = image.naturalWidth
    const h = image.naturalHeight
    if (!w || !h) {
      setError(NOT_A_PHOTO)
      return
    }
    setNatural({ w, h })
    // Opens filling the square, centred, which is the crop somebody who
    // changes nothing gets.
    const s = V / Math.min(w, h)
    setFrame({ s, tx: (V - w * s) / 2, ty: (V - h * s) / 2 })
  }

  // Zoom about a point, so whatever is under the fingers stays under them
  // while the rest of the picture grows around it.
  const zoomAt = (from: Frame, x: number, y: number, factor: number): Frame => {
    const s = Math.min(Math.max(from.s * factor, smallest), smallest * MAX_ZOOM)
    const real = s / from.s
    return held({ s, tx: x - (x - from.tx) * real, ty: y - (y - from.ty) * real })
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const was = pointers.current.get(event.pointerId)
    if (was === undefined || frame === null) return
    const now = { x: event.clientX, y: event.clientY }
    const live = pointers.current
    if (live.size === 2) {
      const [first, second] = Array.from(live.entries())
      const other = first[0] === event.pointerId ? second[1] : first[1]
      const before = Math.hypot(was.x - other.x, was.y - other.y)
      const after = Math.hypot(now.x - other.x, now.y - other.y)
      const box = event.currentTarget.getBoundingClientRect()
      const midX = (now.x + other.x) / 2 - box.left
      const midY = (now.y + other.y) / 2 - box.top
      setFrame((current) =>
        current !== null && before > 0 ? zoomAt(current, midX, midY, after / before) : current
      )
    } else if (live.size === 1) {
      setFrame((current) =>
        current === null
          ? current
          : held({ ...current, tx: current.tx + now.x - was.x, ty: current.ty + now.y - was.y })
      )
    }
    live.set(event.pointerId, now)
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId)
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (frame === null) return
    const box = event.currentTarget.getBoundingClientRect()
    setFrame(
      zoomAt(
        frame,
        event.clientX - box.left,
        event.clientY - box.top,
        event.deltaY < 0 ? 1.1 : 1 / 1.1
      )
    )
  }

  const use = () => {
    const image = picture.current
    if (image === null || frame === null) return
    const canvas = document.createElement('canvas')
    canvas.width = EXPORT
    canvas.height = EXPORT
    const paper = canvas.getContext('2d')
    if (paper === null) {
      setError(NO_BLOB)
      return
    }
    paper.drawImage(
      image,
      -frame.tx / frame.s,
      -frame.ty / frame.s,
      V / frame.s,
      V / frame.s,
      0,
      0,
      EXPORT,
      EXPORT
    )
    // A JPEG rather than a webp: not every browser's canvas writes webp, and
    // the server re-encodes whatever arrives anyway.
    canvas.toBlob(
      (blob) => (blob === null ? setError(NO_BLOB) : onSave(blob)),
      'image/jpeg',
      0.9
    )
  }

  const said = error || failed

  return (
    <Sheet open label="Frame your picture" onClose={onCancel}>
      <p className="t-micro mb-1">Frame your picture</p>
      <p className="mb-3 text-sm text-muted">
        Drag to move it, pinch or scroll to zoom. What is in the square is what other
        members see.
      </p>

      <div className="flex justify-center">
        <div
          // The corner is a share of the side, so the frame rounds the way the
          // avatar does at every size it is shown at.
          className="relative overflow-hidden bg-surface-2"
          style={{ borderRadius: CORNER }}
          style={{ width: V, height: V, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
        >
          {source !== null && (
            <img
              ref={picture}
              src={source}
              alt=""
              draggable={false}
              onLoad={onLoad}
              onError={() => setError(NOT_A_PHOTO)}
              className="max-w-none select-none"
              style={
                frame !== null && natural !== null
                  ? {
                      width: natural.w,
                      height: natural.h,
                      transform: `translate(${frame.tx}px, ${frame.ty}px) scale(${frame.s})`,
                      transformOrigin: '0 0',
                    }
                  : { visibility: 'hidden' }
              }
            />
          )}
          <div
            className="pointer-events-none absolute inset-0 border border-line-strong"
            style={{ borderRadius: CORNER }}
          />
        </div>
      </div>

      {said !== '' && <p className="t-error mt-3">{said}</p>}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className="t-btn t-btn-primary w-full"
          disabled={busy || frame === null}
          onClick={use}
        >
          {busy ? 'Saving' : 'Use photo'}
        </button>
        <button type="button" className="t-btn w-full" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}
