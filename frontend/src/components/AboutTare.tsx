import { WHAT_TARE_DOES, WHAT_TARE_IS } from '../lib/about'

// What tare is, in one place. The invite screen opens it without leaving the
// page, and the About screen shows the same words and the same list.
export function AboutTare({ onBack }: { onBack: () => void }) {
  return (
    <div className="t-card">
      <p className="text-sm">{WHAT_TARE_IS}</p>
      <p className="t-micro mt-4 mb-1">What Tare does</p>
      {WHAT_TARE_DOES.map(([name, what]) => (
        <div key={name} className="t-row min-h-9 items-start gap-2 py-2 text-sm">
          <span className="w-28 shrink-0 font-semibold">{name}</span>
          <span className="min-w-0 flex-1 text-muted">{what}</span>
        </div>
      ))}
      <button className="t-btn mt-3" type="button" onClick={onBack}>
        Back to invite
      </button>
    </div>
  )
}
