import { useState } from 'react'

import { DATA_PRIVACY, platforms, WHAT_TARE_IS, WHAT_YOU_CAN_DO } from '../lib/about'
import { SHOTS, type Shot } from '../lib/screenshots'
import { Lightbox } from './Lightbox'

// What somebody arriving on an invite gets, one line at a time, with the
// pictures of each beside it.
const LINES = [
  'Enter your bio markers (height, weight etc)',
  'Choose an activity level',
  'Get a customized weight loss/maintenance plan',
  'Scan barcodes & track your calories & ingredients easily',
  'Build custom recipes & meals',
  'Upload/sync your Apple/Android workouts or health metrics for calorie adjustments & workout insights',
  'Build your body & Tare from the ground up, with real humans.',
]

// One thumbnail. A phone shot is narrow and a desktop one is about 16:10, and
// both grow a step from 900px.
function Thumb({ shot, onOpen }: { shot: Shot; onOpen: () => void }) {
  const size =
    shot.shape === 'desktop'
      ? 'h-24 w-[154px] min-[900px]:h-40 min-[900px]:w-64'
      : 'h-24 w-11 min-[900px]:h-40 min-[900px]:w-[74px]'
  return (
    <button
      type="button"
      aria-label={shot.caption}
      className={`t-phototile shrink-0 overflow-hidden rounded-lg ${size}`}
      onClick={onOpen}
    >
      {shot.src === null ? (
        <span className="p-1 text-center text-[10px] leading-tight text-muted">
          Put screenshot of {shot.caption} here
        </span>
      ) : (
        <img
          src={shot.src}
          alt={shot.caption}
          loading="lazy"
          decoding="async"
          className="h-full w-full rounded-lg object-cover object-top"
        />
      )}
    </button>
  )
}

// What Tare is, what is inside it, and what it does with your details, in one
// place. About shows the story plainly; the invite shows the seven lines with
// their pictures first and keeps the rest folded away.
export function TareStory({
  onBack,
  onCreate,
  invite = false,
}: {
  onBack?: () => void
  onCreate?: () => void
  invite?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [shot, setShot] = useState<number | null>(null)

  const back = onBack && (
    <button className="t-btn" type="button" onClick={onBack}>
      Back to invite
    </button>
  )

  // The three cards the invite folds open and About always shows.
  const rest = (
    <>
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
        <p className="text-sm">{platforms(window.location.host)}</p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Data privacy</p>
        <p className="text-sm">{DATA_PRIVACY}</p>
      </div>
    </>
  )

  if (!invite) {
    return (
      <>
        <div className="t-card mb-3">
          <p className="t-micro mb-2">What is Tare?</p>
          <p className="text-sm">{WHAT_TARE_IS}</p>
        </div>
        {rest}
        {back}
      </>
    )
  }

  // On a phone the form has been pushed off screen, so the button puts it
  // back; from 900px the form is already beside this and only wants focus.
  const create = () => {
    if (window.matchMedia('(min-width: 900px)').matches) onCreate?.()
    else onBack?.()
  }

  return (
    <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">What is Tare?</p>
        {LINES.map((line, at) => (
          <div
            key={line}
            className={`min-[900px]:grid min-[900px]:grid-cols-[1fr_auto] min-[900px]:items-center min-[900px]:gap-4 ${
              at === 0 ? 'pb-3' : 'border-t border-line py-3'
            }`}
          >
            <p className="text-sm">{line}</p>
            <div className="mt-2 flex gap-2 min-[900px]:mt-0">
              {SHOTS.flatMap((each, index) =>
                each.line === at + 1
                  ? [<Thumb key={each.id} shot={each} onOpen={() => setShot(index)} />]
                  : [],
              )}
            </div>
          </div>
        ))}
        <div className="mt-3 flex gap-2">
          <button className="t-btn t-btn-primary" type="button" onClick={create}>
            Create an account
          </button>
          <button
            className="t-btn"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Show less' : 'Keep reading'}
          </button>
        </div>
        {/* No heading: the card already says what this is answering. */}
        {open && <p className="mt-3 text-sm">{WHAT_TARE_IS}</p>}
      </div>

      {open && rest}
      {back}

      {shot !== null && (
        <Lightbox
          items={SHOTS.map((each) => ({
            src: each.src,
            alt: each.caption,
            caption: each.caption,
            shape: each.shape,
          }))}
          index={shot}
          onIndex={setShot}
          onClose={() => setShot(null)}
        />
      )}
    </>
  )
}
