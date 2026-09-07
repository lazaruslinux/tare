import { Gallery } from './Gallery'
import { DATA_PRIVACY, PLATFORMS, WHAT_TARE_IS, WHAT_YOU_CAN_DO } from '../lib/about'
import { SHOTS } from '../lib/screenshots'

// What Tare is, what is inside it, what it does with your details, and a look
// at it, in one place. The invite screen shows it and so does About, so the two cannot
// drift apart.
export function TareStory({ onBack }: { onBack?: () => void }) {
  return (
    <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">What is Tare?</p>
        <p className="text-sm">{WHAT_TARE_IS}</p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">What can I do with Tare?</p>
        {WHAT_YOU_CAN_DO.map((item, at) => (
          <div
            key={item.name}
            className={at === 0 ? 'pb-3' : 'border-t border-line py-3 last:pb-0'}
          >
            <p className="text-sm font-semibold">{item.name}</p>
            <p className="mt-0.5 text-sm text-muted">{item.what}</p>
          </div>
        ))}
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Desktop and mobile</p>
        <p className="text-sm">{PLATFORMS}</p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Data privacy</p>
        <p className="text-sm">{DATA_PRIVACY}</p>
      </div>

      {/* One gallery for the whole story, at the end, read sideways. */}
      <div className="t-card mb-3">
        <p className="t-micro mb-2">Screenshots</p>
        <Gallery shots={SHOTS} />
      </div>

      {onBack && (
        <button className="t-btn" type="button" onClick={onBack}>
          Back to invite
        </button>
      )}
    </>
  )
}
