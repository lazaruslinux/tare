import { ChevronLeft, ChevronRight, CircleCheck, Plus } from 'lucide-react'

import type { TopBarView } from '../hooks/useTopBar'
import { RoleMark } from './RoleMark'
import { TareWordmark } from './TareWordmark'

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
  onToggleMark,
  onHome,
}: {
  view: TopBarView
  onBack: () => void
  // A day either way, and back to today.
  onStep: (days: number) => void
  onToday: () => void
  // The right-hand button, whatever the screen on top hung on it.
  onAct: () => void
  // The check beside it, on the one screen that has one.
  onToggleMark: () => void
  // The wordmark is the way home: Dashboard, top of the page.
  onHome: () => void
}) {
  const { kind, title, backLabel, subtitle, subtitleRole, atToday, action, mark } = view
  // The left slot matches the right one button for button, so the day in the
  // middle stays in the middle however many sit beside it.
  const buttons = (action === null ? 0 : 1) + (mark === null ? 0 : 1)
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
              className="t-topbar-mark t-tap44 px-2"
              aria-label="Dashboard"
              onClick={onHome}
            >
              <TareWordmark size={18} />
            </button>
            {/* The rail carries the name at rail width, so the slot says which
                screen this is instead. */}
            <p className="t-topbar-title t-topbar-wide truncate">{title}</p>
          </>
        )}
        {kind === 'title' && (
          <div className="min-w-0">
            <p className="t-topbar-title truncate">{title}</p>
            {subtitle !== null && (
              <p className="t-topbar-sub truncate">
                {subtitle}
                <RoleMark role={subtitleRole} />
              </p>
            )}
          </div>
        )}
        {/* Nothing on the left of the day chooser; this keeps the middle in
            the middle while the right slot holds a button. Dropped on a narrow
            bar, where the mirror is the width the day itself needs: the
            chooser sits left of the pill rather than under it. */}
        {kind === 'pager' &&
          Array.from({ length: buttons }, (_, slot) => (
            <span key={slot} className="hidden w-11 min-[480px]:block" aria-hidden="true" />
          ))}
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
        {mark !== null && (
          <button
            type="button"
            className={`t-chip t-tap44 shrink-0 ${
              mark.done ? 'border-accent text-accent' : ''
            }`}
            aria-label={mark.label}
            aria-pressed={mark.done}
            onClick={onToggleMark}
          >
            {/* The same check either way: hollow while the day is open, a
                filled green disc once it is complete. The word beside it says
                what the check is about, which the check alone never did. */}
            {mark.done ? (
              <CircleCheck
                className="h-4 w-4"
                strokeWidth={2.5}
                fill="currentColor"
                stroke="var(--bg)"
              />
            ) : (
              <CircleCheck className="h-4 w-4" strokeWidth={2.5} />
            )}
            {mark.done ? 'Completed' : 'Complete'}
          </button>
        )}
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
