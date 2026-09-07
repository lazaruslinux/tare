import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'

// One picture, as big as the screen allows, over everything. A tap anywhere
// or Escape puts it away. Pinch zoom is the browser's own, so nothing here
// has to pretend to be a photo viewer.
//
// It is also the way a gallery is looked through: given items and an index it
// carries arrows, the arrow keys and a swipe, and says under the picture what
// the picture is.
export type LightboxItem = {
  src: string | null
  alt: string
  caption?: string
  // Only for an item with no file yet: which frame the missing picture is.
  shape?: 'phone' | 'desktop'
}

type Single = { src: string; alt: string; onClose: () => void }
type Many = {
  items: LightboxItem[]
  index: number
  onIndex: (next: number) => void
  onClose: () => void
}

export function Lightbox(props: Single | Many) {
  const gallery = 'items' in props
  const { onClose } = props
  const items = gallery ? props.items : []
  const index = gallery ? props.index : 0
  const onIndex = gallery ? props.onIndex : undefined
  // Where a pointer went down, and whether it travelled far enough to count as
  // a swipe rather than a tap that closes.
  const from = useRef<number | null>(null)
  const swiped = useRef(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (!onIndex) return
      if (event.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (event.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onIndex, index, items.length])

  if (!gallery) {
    return (
      <button
        type="button"
        aria-label="Close the picture"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
        onClick={onClose}
      >
        <img src={props.src} alt={props.alt} className="max-h-full max-w-full rounded-xl" />
      </button>
    )
  }

  const item = items[index]
  if (!item) return null
  const words = item.caption ?? item.alt

  const move = (next: number) => {
    if (next < 0 || next > items.length - 1) return
    onIndex?.(next)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={words}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="flex min-h-0 w-full flex-1 items-center justify-center"
        onPointerDown={(event) => {
          from.current = event.clientX
          swiped.current = false
        }}
        onPointerUp={(event) => {
          const start = from.current
          from.current = null
          if (start === null) return
          const travelled = event.clientX - start
          if (Math.abs(travelled) <= 40) return
          swiped.current = true
          move(travelled < 0 ? index + 1 : index - 1)
        }}
        onClick={(event) => {
          // A swipe that ends over the picture is not a tap to close.
          if (!swiped.current) return
          swiped.current = false
          event.stopPropagation()
        }}
      >
        {item.src === null ? (
          <div
            className={`t-phototile max-h-full rounded-xl p-4 text-center text-sm text-muted ${
              item.shape === 'desktop'
                ? 'aspect-[16/10] w-full max-w-3xl'
                : 'aspect-[9/19.5] h-[70svh]'
            }`}
          >
            Put screenshot of {words} here
          </div>
        ) : (
          <img src={item.src} alt={item.alt} className="max-h-full max-w-full rounded-xl" />
        )}
      </div>
      <p className="text-center text-sm text-white/80">{words}</p>
      {index > 0 && (
        <button
          type="button"
          aria-label="Previous picture"
          className="absolute top-1/2 left-2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation()
            move(index - 1)
          }}
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          type="button"
          aria-label="Next picture"
          className="absolute top-1/2 right-2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation()
            move(index + 1)
          }}
        >
          <ChevronRight className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
