import { ChevronLeft, Settings } from 'lucide-react'

// The bar every screen is read under. It says where you are, offers the way
// back out of a sub-view, and keeps settings one tap away on a phone. The rail
// already carries the name and reaches settings through More, so at that width
// the stylesheet drops both and leaves the title and the way back.
export function TopBar({
  title,
  backLabel,
  waiting,
  onBack,
  onSettings,
  onHome,
}: {
  title: string
  // Null on a top-level screen, where the wordmark takes the slot instead.
  backLabel: string | null
  // Submissions waiting on an administrator. Nought for everybody else.
  waiting: number
  onBack: () => void
  onSettings: () => void
  // The wordmark is the way home: Dashboard, top of the page.
  onHome: () => void
}) {
  return (
    <header className="t-topbar">
      <div className="flex min-w-0 justify-start">
        {backLabel === null ? (
          <button
            type="button"
            className="t-topbar-mark t-tap44 px-2 text-lg font-semibold tracking-tight lowercase"
            aria-label="Dashboard"
            onClick={onHome}
          >
            tare
          </button>
        ) : (
          <button type="button" className="t-topbar-back" onClick={onBack}>
            <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="truncate">{backLabel}</span>
          </button>
        )}
      </div>
      <p className="truncate px-1 text-center text-sm font-semibold">{title}</p>
      <div className="flex min-w-0 justify-end">
        <button
          type="button"
          className="t-topbar-gear"
          aria-label={waiting > 0 ? `Settings, ${waiting} waiting` : 'Settings'}
          onClick={onSettings}
        >
          <Settings className="h-5 w-5" strokeWidth={2} />
          {waiting > 0 && <span className="t-topbar-count t-nums">{waiting}</span>}
        </button>
      </div>
    </header>
  )
}
