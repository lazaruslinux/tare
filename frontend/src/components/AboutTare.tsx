import { WHAT_TARE_IS } from '../lib/about'

// What tare is, in one place. The invite screen opens it without leaving the
// page, and the About screen shows the same words.
export function AboutTare({ onBack }: { onBack: () => void }) {
  return (
    <div className="t-card">
      <p className="text-sm">{WHAT_TARE_IS}</p>
      <button className="t-btn mt-3" type="button" onClick={onBack}>
        Back to invite
      </button>
    </div>
  )
}
