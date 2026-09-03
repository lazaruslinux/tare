import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'

import type { TopBarView } from '../hooks/useTopBar'

// The bar every screen is read under. Each top-level tab wears its own: the
// dashboard the wordmark, the journal its day chooser, the other two a large
// title and whatever one button belongs beside it. A sub-view wears the way
// back out of itself and its name in the middle.
export function TopBar({
  view,
  onBack,
  onStep,
  onToday,
  onAct,
  onHome,
}: {
  view: TopBarView
  onBack: () => void
  // A day either way, and back to today.
  onStep: (days: number) => void
  onToday: () => void
  // The right-hand button, whatever the screen on top hung on it.
  onAct: () => void
  // The wordmark is the way home: Dashboard, top of the page.
  onHome: () => void
}) {
  const { kind, title, backLabel, subtitle, atToday, action } = view
  return (
    <header className="t-topbar">
      <div className="flex min-w-0 items-center justify-start">
        {kind === 'back' && (
          <button type="button" className="t-topbar-back" onClick={onBack}>
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="truncate">{backLabel}</span>
          </button>
        )}
        {kind === 'wordmark' && (
          <>
            <button
              type="button"
              className="t-topbar-mark t-tap44 px-2 text-lg font-semibold tracking-tight"
              aria-label="Dashboard"
              onClick={onHome}
            >
              Tare
            </button>
            {/* The rail carries the name at rail width, so the slot says which
                screen this is instead. */}
            <p className="t-topbar-title t-topbar-wide truncate">{title}</p>
          </>
        )}
        {kind === 'title' && (
          <div className="min-w-0">
            <p className="t-topbar-title truncate">{title}</p>
            {subtitle !== null && <p className="t-topbar-sub truncate">{subtitle}</p>}
          </div>
        )}
        {/* Nothing on the left of the day chooser; this keeps the middle in
            the middle while the right slot holds a button. */}
        {kind === 'pager' && action !== null && <span className="w-11" aria-hidden="true" />}
      </div>
      {kind === 'pager' ? (
        <div className="flex min-w-0 items-center justify-center">
          <button
            type="button"
            className="t-topbar-icon"
            aria-label="Previous day"
            onClick={() => onStep(-1)}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            className="min-h-11 min-w-28 truncate px-1 text-center text-sm font-semibold"
            onClick={onToday}
          >
            {title}
          </button>
          <button
            type="button"
            className="t-topbar-icon disabled:opacity-30"
            aria-label="Next day"
            disabled={atToday}
            onClick={() => onStep(1)}
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      ) : kind === 'back' ? (
        <p className="truncate px-1 text-center text-sm font-semibold">{title}</p>
      ) : (
        <span />
      )}
      <div className="flex min-w-0 items-center justify-end">
        {action !== null && (
          <button
            type="button"
            className="t-topbar-icon text-accent"
            aria-label={action}
            onClick={onAct}
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </header>
  )
}
