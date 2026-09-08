import { useState } from 'react'

import { DATA_PRIVACY, platforms, WHAT_TARE_IS, WHAT_YOU_CAN_DO } from '../lib/about'
import { SHOTS } from '../lib/screenshots'
import { Lightbox } from './Lightbox'
import { Slideshow } from './Slideshow'

// What somebody arriving on an invite gets, one line at a time: each line is a
// slide of the slideshow, with its pictures on it.
const LINES = [
  'Enter your bio markers (height, weight etc)',
  'Choose an activity level',
  'Get a customized weight loss/maintenance plan',
  'Scan barcodes & track your calories & ingredients easily',
  'Build custom recipes & meals',
  'Upload/sync your Apple/Android workouts or health metrics for calorie adjustments & workout insights',
  'Build your body & Tare from the ground up, with real humans.',
]

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
        <Slideshow
          slides={LINES.map((line, at) => ({
            title: line,
            shots: SHOTS.filter((each) => each.line === at + 1),
          }))}
          onOpen={setShot}
        />
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
