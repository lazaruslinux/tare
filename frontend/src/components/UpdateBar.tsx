import { reload, useNeedRefresh } from '../lib/update'

// One row at the top of the app when a new build is waiting. No way to dismiss
// it: the build is already downloaded, and the only thing left to decide is
// when to take it. It is gone the moment the page reloads.
export function UpdateBar() {
  const ready = useNeedRefresh()
  if (!ready) return null
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-2">
      <p className="text-sm">New version ready.</p>
      <button type="button" className="t-btn shrink-0" onClick={reload}>
        Reload
      </button>
    </div>
  )
}
