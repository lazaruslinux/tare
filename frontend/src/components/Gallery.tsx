import { useState } from 'react'

import type { Shot } from '../lib/screenshots'
import { Lightbox } from './Lightbox'

// A row of pictures read sideways, one row per thing Tare does. A tile with no
// file behind it yet says what belongs in it, so the shape of the page is the
// same before and after the real screenshots land.
export function Gallery({ shots }: { shots: Shot[] }) {
  const [open, setOpen] = useState<number | null>(null)

  if (shots.length === 0) return null

  return (
    <>
      {/* The padding is there so a focus ring on the first tile is not cut off
          by the scroller's own edge. */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2">
        {shots.map((shot, at) => (
          <button
            key={shot.id}
            type="button"
            aria-label={shot.caption}
            className={`t-phototile h-60 shrink-0 snap-start rounded-lg ${
              shot.shape === 'desktop' ? 'w-[384px]' : 'w-[111px]'
            }`}
            onClick={() => setOpen(at)}
          >
            {shot.src === null ? (
              <span className="p-2 text-center text-xs text-muted">
                Put screenshot of {shot.caption} here
              </span>
            ) : (
              <img
                src={shot.src}
                alt={shot.caption}
                loading="lazy"
                decoding="async"
                className="h-full w-full rounded-lg object-cover"
              />
            )}
          </button>
        ))}
      </div>
      {open !== null && (
        <Lightbox
          items={shots.map((shot) => ({
            src: shot.src,
            alt: shot.caption,
            caption: shot.caption,
            shape: shot.shape,
          }))}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  )
}
