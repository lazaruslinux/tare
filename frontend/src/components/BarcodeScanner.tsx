import { Flashlight, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'

import { BARCODE } from '../lib/community'

// The camera, over everything else. Drawn through a portal and in fixed dark
// colours rather than the app's own: it sits on top of a video feed, and a
// light theme behind a camera is a white sheet with a picture cut out of it.
//
// The typed field at the bottom is always there. It is what a desktop browser
// with no camera uses, what a phone that was refused permission uses, and what
// anybody standing under a bad light uses when the bars will not read.

// How often a frame is taken. Faster than this and the decoder is still busy
// with the last one; slower and it feels like the camera is not looking.
const CADENCE = 150
// Most frames decode a square crop from the middle, which is full pixel
// density where the reticle points and far cheaper than the whole frame. Every
// fourth takes the lot, for a code held off to one side.
const CROP = 0.7
const FULL_EVERY = 4

export function BarcodeScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [notice, setNotice] = useState<string | null>('Starting the camera.')
  const [typed, setTyped] = useState('')
  // Only there when the camera says it has a light. Most rear cameras on a
  // phone do; nothing else does.
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null)
  // Set the moment a code is accepted, so a second frame already in flight
  // cannot hand the same scan over twice.
  const done = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: number | undefined
    let cancelled = false

    const start = async () => {
      let read: (frame: ImageData) => Promise<string | null>
      try {
        read = (await import('../lib/scanner')).readCode
      } catch {
        setNotice('The scanner did not load. Type the number instead.')
        return
      }
      // The camera needs a secure context. On plain http this call is simply
      // not there, and the field below is the way in.
      if (!navigator.mediaDevices?.getUserMedia) {
        setNotice('No camera here. Type the number under the bars instead.')
        return
      }
      try {
        // Asked for outright. Left to itself the browser picks something small,
        // and a barcode at arm's length lands on too few pixels to ever read.
        // 'ideal' means a camera that cannot manage it gives what it has.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
      } catch {
        setNotice('The camera is unavailable or blocked. Type the number instead.')
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        // Some browsers refuse an early play. The loop below reads frames once
        // the video has any, so this is not worth saying anything about.
      }
      setNotice(null)

      const track = stream.getVideoTracks()[0]
      if (track) {
        // Helps a phone that would otherwise focus once and stop. A browser
        // that has never heard of the constraint refuses or ignores it, and
        // both are fine.
        track
          .applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
          .catch(() => {})
        const able = track.getCapabilities?.() as
          | (MediaTrackCapabilities & { torch?: boolean })
          | undefined
        if (able?.torch && !cancelled) setTorch({ track, on: false })
      }

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return
      let busy = false
      let tick = 0
      // Leaving during the camera's warm-up above means the cleanup has already
      // run. Starting the loop now would leave it running for good.
      if (cancelled) return
      timer = window.setInterval(async () => {
        if (busy || done.current || !video.videoWidth) return
        busy = true
        try {
          const whole = ++tick % FULL_EVERY === 0
          const side = Math.round(CROP * Math.min(video.videoWidth, video.videoHeight))
          const width = whole ? video.videoWidth : side
          const height = whole ? video.videoHeight : side
          canvas.width = width
          canvas.height = height
          if (whole) {
            context.drawImage(video, 0, 0)
          } else {
            const left = Math.round((video.videoWidth - side) / 2)
            const top = Math.round((video.videoHeight - side) / 2)
            context.drawImage(video, left, top, side, side, 0, 0, side, side)
          }
          const code = await read(context.getImageData(0, 0, width, height))
          if (code && !done.current) {
            done.current = true
            onCode(code)
          }
        } catch {
          // One frame the decoder choked on. The next one is 150ms away.
        } finally {
          busy = false
        }
      }, CADENCE)
    }

    void start()
    return () => {
      cancelled = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onCode])

  const toggleTorch = () => {
    if (!torch) return
    const on = !torch.on
    torch.track
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(() => setTorch({ ...torch, on }))
      .catch(() => {})
  }

  const useTyped = (event: FormEvent) => {
    event.preventDefault()
    const code = typed.trim()
    if (!BARCODE.test(code) || done.current) return
    done.current = true
    onCode(code)
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between p-4">
        <span className="text-xs font-semibold tracking-[0.08em] text-white/70 uppercase">
          Scan a barcode
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the scanner"
          className="t-tap44 rounded-lg p-1.5 text-white/70"
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-40 w-72 max-w-[85%] rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {notice && (
          <p className="absolute inset-x-4 top-4 rounded-xl bg-black/75 p-3 text-center text-sm text-white/90">
            {notice}
          </p>
        )}
        {torch && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-label={torch.on ? 'Turn the light off' : 'Turn the light on'}
            aria-pressed={torch.on}
            className={`absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border p-3.5 ${
              torch.on
                ? 'border-white bg-white text-black'
                : 'border-white/40 bg-black/50 text-white'
            }`}
          >
            <Flashlight className="h-5 w-5" strokeWidth={2} />
          </button>
        )}
      </div>

      <form onSubmit={useTyped} className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <label className="mb-1.5 block text-xs font-semibold text-white/60" htmlFor="scan-typed">
          Type the number instead
        </label>
        <div className="flex items-center gap-2">
          <input
            id="scan-typed"
            value={typed}
            onChange={(event) => setTyped(event.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            maxLength={14}
            placeholder="The digits under the bars"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/20 bg-white/10 px-4 text-white tabular-nums placeholder:text-white/40"
          />
          <button
            type="submit"
            disabled={!BARCODE.test(typed.trim())}
            className="min-h-11 shrink-0 rounded-xl bg-white/15 px-4 font-semibold text-white disabled:opacity-40"
          >
            Use
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
