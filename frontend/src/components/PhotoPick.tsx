import { useReducedMotion } from 'framer-motion'
import { RotateCcw, RotateCw } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'

import { MAX_PHOTO_BYTES, PHOTO_TOO_LARGE } from '../lib/community'
import { Sheet } from './Sheet'

// Where a picture of food comes from, and which way up it goes, decided once
// for every screen that takes one. The input carries no capture attribute on
// purpose: without one the phone offers its own menu of the camera roll, the
// camera and the files, instead of opening the camera on the spot.
//
// Nothing is sent until Use photo. The preview turns with CSS and the server
// makes the real turn, so no picture is decoded and redrawn on a phone.

const NOT_A_PHOTO = 'That file is not a picture this app can read.'

export function PhotoPick({
  id,
  disabled,
  onPicked,
  onRefused,
}: {
  // The input's own id, so a label that already points at it still opens it.
  id: string
  disabled?: boolean
  onPicked: (file: File, rotate: number) => void
  onRefused: (message: string) => void
}) {
  const field = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<File | null>(null)
  const [source, setSource] = useState<string | null>(null)
  // Kept as a running count rather than folded to a quarter, so turning left
  // from the top animates to -90 instead of the long way round to 270.
  const [turn, setTurn] = useState(0)
  const reduced = useReducedMotion()

  const take = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_PHOTO_BYTES) {
      onRefused(PHOTO_TOO_LARGE)
      return
    }
    // Read as text rather than handed out as a blob address, because the
    // content policy this app is served under takes pictures from itself and
    // from data and from nowhere else.
    const reader = new FileReader()
    reader.onload = () => {
      setSource(String(reader.result))
      setTurn(0)
      setChosen(file)
    }
    reader.onerror = () => onRefused(NOT_A_PHOTO)
    reader.readAsDataURL(file)
  }

  // Closing the sheet any other way than Use photo drops the file and sends
  // nothing.
  const drop = () => {
    setChosen(null)
    setSource(null)
    setTurn(0)
  }

  const use = () => {
    const file = chosen
    if (file === null) return
    const degrees = ((turn % 360) + 360) % 360
    drop()
    onPicked(file, degrees)
  }

  return (
    <>
      <input
        ref={field}
        id={id}
        className="sr-only"
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={take}
      />
      <Sheet open={chosen !== null} label="Check the photo" onClose={drop}>
        <p className="t-micro mb-2">Check the photo</p>
        {/* A contained picture in a square box has room for every quarter
            turn, so nothing is ever clipped by one. */}
        <div className="aspect-square w-full overflow-hidden rounded-xl border border-line bg-surface-2">
          {source !== null && (
            <img
              src={source}
              alt=""
              className="h-full w-full object-contain"
              style={{
                transform: `rotate(${turn}deg)`,
                transition: reduced ? undefined : 'transform 0.18s',
              }}
            />
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="t-btn flex-1"
            onClick={() => setTurn((was) => was - 90)}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Rotate left
          </button>
          <button
            type="button"
            className="t-btn flex-1"
            onClick={() => setTurn((was) => was + 90)}
          >
            <RotateCw className="h-4 w-4" strokeWidth={2} />
            Rotate right
          </button>
        </div>
        <div className="mt-4 flex flex-col items-center gap-2">
          <button type="button" className="t-btn t-btn-primary w-full" onClick={use}>
            Use photo
          </button>
          <button
            type="button"
            className="t-tap44 text-sm font-semibold text-muted"
            onClick={() => {
              drop()
              field.current?.click()
            }}
          >
            Choose another
          </button>
        </div>
      </Sheet>
    </>
  )
}
