import { motion, useReducedMotion } from 'framer-motion'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import type { TourStep } from '../lib/tour'

// The box the spotlight cuts, in viewport coordinates.
type Box = { top: number; left: number; width: number; height: number }

// Room around the anchor, and the smallest gap the card keeps from an edge.
const PAD = 8
const MARGIN = 16
// How long an anchor is waited for after a step change. A tab fades in over
// 0.18 s, so the element the step points at is not there to measure yet.
const WAIT = 1000
const CARD_MAX = 384

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

// Whether the element is pinned to the viewport. Scrolling one of those into
// view moves the page under it rather than bringing it into sight.
function pinned(element: Element): boolean {
  let node: HTMLElement | null = element instanceof HTMLElement ? element : null
  while (node !== null) {
    const position = getComputedStyle(node).position
    if (position === 'fixed' || position === 'sticky') return true
    node = node.parentElement
  }
  return false
}

function find(anchor: string | undefined): HTMLElement | null {
  if (anchor === undefined) return null
  return document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`)
}

function measure(anchor: string | undefined): Box | null {
  const element = find(anchor)
  if (element === null) return null
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  }
}

const same = (a: Box | null, b: Box | null): boolean =>
  a === null || b === null
    ? a === b
    : a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height

// The layer the tour is drawn on: one hole in a dark ground, and a card that
// says what the hole is. It points at what the app already draws rather than
// drawing its own copy of anything, so nothing here can fall out of step with
// the screen underneath.
export function Tour({
  step,
  steps,
  wide,
  onNext,
  onBack,
  onSkip,
  onDone,
}: {
  step: number
  steps: TourStep[]
  // Whether the side rail is the navigation, which decides which of a step's
  // two anchors exists on screen.
  wide: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
  onDone: () => void
}) {
  const reduced = useReducedMotion()
  const card = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  // How big the card came out, so it can be kept inside the viewport.
  const [size, setSize] = useState({ width: CARD_MAX, height: 160 })
  const titleId = useId()

  const current = steps[step]
  const last = step === steps.length - 1
  const anchor = wide ? current.target?.wide : current.target?.phone

  const next = useCallback(() => (last ? onDone() : onNext()), [last, onDone, onNext])

  // Read the anchor again and again for a moment after a step change: the tab
  // it lives on may still be animating in, and it may need scrolling to first.
  useEffect(() => {
    let frame = 0
    let scrolled = false
    const start = performance.now()
    const tick = () => {
      const element = find(anchor)
      if (element !== null && !scrolled) {
        scrolled = true
        if (!pinned(element)) element.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
      const found = measure(anchor)
      setBox((was) => (same(was, found) ? was : found))
      if (performance.now() - start < WAIT) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [anchor, step])

  // The hole follows what it is cut around, wherever the page goes. Capture,
  // so a scroll inside a list counts as well as the page's own.
  useEffect(() => {
    const again = () => {
      const found = measure(anchor)
      setBox((was) => (same(was, found) ? was : found))
    }
    window.addEventListener('resize', again)
    window.addEventListener('scroll', again, true)
    return () => {
      window.removeEventListener('resize', again)
      window.removeEventListener('scroll', again, true)
    }
  }, [anchor])

  useLayoutEffect(() => {
    const rect = card.current?.getBoundingClientRect()
    if (rect === undefined) return
    setSize((was) =>
      was.width === rect.width && was.height === rect.height
        ? was
        : { width: rect.width, height: rect.height }
    )
  })

  // The card takes the focus on every step, so what is read out is what is on
  // screen and the keys below land somewhere.
  useEffect(() => {
    card.current?.focus()
  }, [step])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (last) onDone()
        else onSkip()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        next()
      } else if (event.key === 'ArrowLeft' && step > 0) {
        event.preventDefault()
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, next, onBack, onDone, onSkip, step])

  // Tab stays inside the card: the app behind is not reachable while the tour
  // is driving it.
  const trap = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab' || card.current === null) return
    const stops = Array.from(card.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (stops.length === 0) return
    const first = stops[0]
    const end = stops[stops.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === card.current)) {
      event.preventDefault()
      end.focus()
    } else if (!event.shiftKey && active === end) {
      event.preventDefault()
      first.focus()
    }
  }

  // Where the card sits. Centred with nothing to point at; on a phone it hangs
  // from whichever end of the screen the anchor is not at; beside the anchor
  // where the rail is, and under it when there is no room to the right.
  let place: CSSProperties
  if (box === null) {
    place = {
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: MARGIN,
    }
  } else if (!wide) {
    const low = box.top + box.height / 2 > (window.innerHeight * 2) / 3
    place = low
      ? { left: MARGIN, right: MARGIN, top: 'calc(1rem + env(safe-area-inset-top))' }
      : { left: MARGIN, right: MARGIN, bottom: 'calc(1rem + env(safe-area-inset-bottom))' }
  } else {
    const width = Math.min(CARD_MAX, window.innerWidth - MARGIN * 2)
    const right = box.left + box.width + 12
    const beside = right + width <= window.innerWidth - MARGIN
    place = {
      width,
      left: clamp(
        beside ? right : box.left,
        MARGIN,
        Math.max(MARGIN, window.innerWidth - width - MARGIN)
      ),
      top: clamp(
        beside ? box.top : box.top + box.height + 12,
        MARGIN,
        Math.max(MARGIN, window.innerHeight - size.height - MARGIN)
      ),
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 overflow-hidden"
      onKeyDown={trap}
    >
      {box === null ? (
        <div className="absolute inset-0 bg-black/50" />
      ) : (
        // One box with a shadow big enough to cover the rest of the screen.
        <div
          className="pointer-events-none absolute rounded-2xl"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: '0 0 0 200vmax rgba(0, 0, 0, 0.5)',
          }}
        />
      )}
      <div className="absolute" style={place}>
        <motion.div
          key={step}
          ref={card}
          tabIndex={-1}
          className="t-card mx-auto w-full max-w-sm outline-none"
          initial={{ opacity: 0, y: reduced ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
        >
          <p id={titleId} className="text-base font-semibold">
            {current.title}
          </p>
          <p className="mt-1 text-sm text-muted">{current.body}</p>
          <p className="t-micro mt-3">
            {step + 1} of {steps.length}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {step > 0 && (
              <button type="button" className="t-btn" onClick={onBack}>
                Back
              </button>
            )}
            <button type="button" className="t-btn t-btn-primary" onClick={next}>
              {last ? 'Done' : 'Next'}
            </button>
            {!last && (
              <button type="button" className="ml-auto text-sm text-muted" onClick={onSkip}>
                Skip
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
