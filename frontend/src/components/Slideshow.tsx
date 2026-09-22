import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { SHOTS, type Shot } from '../lib/screenshots'

export type Slide = { title: string; shots: Shot[] }

// One picture on a slide, big enough to read where it sits. A phone shot is
// narrow and a desktop one is 16:10; below 900px they stack and the desktop
// one takes the column's width.
function Picture({ shot, alone, onOpen }: { shot: Shot; alone: boolean; onOpen: () => void }) {
  // A picture with the slide to itself fills the slide's height.
  // A lone phone shot keeps the one size at every width: more room used to buy
  // a smaller picture, and it is the only thing the slide has to show.
  const size =
    shot.shape === 'desktop'
      ? 'aspect-[16/10] w-full min-[900px]:aspect-auto min-[900px]:h-80 min-[900px]:w-[512px]'
      : alone
        ? 'h-full w-[237px]'
        : 'h-72 w-[133px] min-[900px]:h-80 min-[900px]:w-[148px]'
  return (
    <button
      type="button"
      aria-label={shot.caption}
      className={`t-phototile overflow-hidden rounded-lg ${size}`}
      onClick={onOpen}
    >
      <img
        src={shot.src}
        alt={shot.caption}
        loading="lazy"
        decoding="async"
        className="h-full w-full rounded-lg object-cover object-top"
      />
    </button>
  )
}

// The eight lines of the invite as one slideshow: a line, its pictures, and a
// row of arrows and dots. Arrows wrap, the picture area swipes, and the region
// takes the arrow keys when it has focus.
export function Slideshow({
  slides,
  onOpen,
}: {
  slides: Slide[]
  onOpen: (shotIndex: number) => void
}) {
  const [at, setAt] = useState(0)
  const from = useRef<number | null>(null)

  const move = (step: number) => setAt((now) => (now + step + slides.length) % slides.length)
  const slide = slides[at]
  if (!slide) return null
  // One phone shot and nothing else: the row keeps the taller height, so the
  // picture is the same size at every width.
  const lonePhone = slide.shots.length === 1 && slide.shots[0].shape === 'phone'

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="What is Tare"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') move(-1)
        if (event.key === 'ArrowRight') move(1)
      }}
    >
      {/* The swipe is the slide's, not the pictures': a line waiting for its
          shots has no picture row to start one on. */}
      <div
        className="transition-opacity duration-150 motion-reduce:transition-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          from.current = event.clientX
        }}
        onPointerUp={(event) => {
          const start = from.current
          from.current = null
          if (start === null) return
          const travelled = event.clientX - start
          if (Math.abs(travelled) <= 40) return
          move(travelled < 0 ? 1 : -1)
        }}
      >
        <h2 className="text-lg font-semibold min-[900px]:text-xl">{slide.title}</h2>
        {slide.shots.length > 0 && (
          <div
            className={`mt-3 flex flex-col items-center justify-center gap-3 min-[900px]:flex-row ${
              lonePhone ? 'h-[32rem]' : 'h-[32rem] min-[900px]:h-96'
            }`}
          >
            {slide.shots.map((shot) => (
              <Picture
                key={shot.id}
                shot={shot}
                alone={slide.shots.length === 1}
                onOpen={() => onOpen(SHOTS.indexOf(shot))}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button className="t-btn t-tap44" type="button" onClick={() => move(-1)}>
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
          <span className="sr-only">Previous</span>
        </button>
        {/* A 10px dot in a 24px button that is 44px tall: the targets sit
            side by side instead of overlapping two or three neighbours. */}
        <div className="flex flex-1 items-center justify-center">
          {slides.map((each, index) => (
            <button
              key={each.title}
              type="button"
              aria-label={`Slide ${index + 1} of ${slides.length}`}
              aria-current={index === at ? 'true' : undefined}
              className="flex h-11 w-6 items-center justify-center"
              onClick={() => setAt(index)}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  index === at ? 'bg-accent' : 'bg-line-strong'
                }`}
              />
            </button>
          ))}
        </div>
        <button className="t-btn t-tap44" type="button" onClick={() => move(1)}>
          <ChevronRight className="h-5 w-5" strokeWidth={2} />
          <span className="sr-only">Next</span>
        </button>
        <span className="t-nums text-xs text-muted">
          {at + 1} of {slides.length}
        </span>
      </div>
    </div>
  )
}
