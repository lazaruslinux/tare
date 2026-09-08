import { KeyRound } from 'lucide-react'
import { type ChangeEvent, useEffect, useId, useState } from 'react'

import {
  api,
  errorText,
  uploadFile,
  type MintedKey,
  type Removed,
  type Synced,
  type SyncKey,
} from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Lightbox } from '../components/Lightbox'
import { stampText, useClock } from '../lib/clock'

type Platform = 'iphone' | 'android'

// What this screen is for, said once, to somebody who has never connected a
// phone to anything.
const WHAT_THIS_IS =
  'Tare takes the health data your phone exports and turns it into your ' +
  'Dashboard and Fitness screens: steps, calories, workouts and more. Setup ' +
  'is one time. Pick your device below.'

// What the key card says, before there is a key and after there is one.
const SHOWN_ONCE =
  'The key is shown once. Copy both lines into your phone before you leave this screen.'
const ALREADY_MADE =
  "You've already created a key, which was only shown once. To make a new one, " +
  'click below. Creating a new key will disable the old one.'

// What each phone needs, in the order somebody does it. Written for a person
// who has never set up an automation, so every step is one thing to do. A
// picture under a step is the screen it describes, opened big on a tap.
type Picture = { src: string; alt: string }
type Step = { text: string; pictures?: Picture[] }

const IPHONE_STEPS: Step[] = [
  {
    text: 'Find and install Health Auto Export from the App Store.',
    pictures: [{ src: '/guide/hae-app-store.webp', alt: 'Health Auto Export on the App Store' }],
  },
  {
    text: "Open the app and let it read Apple Health when it asks. Without that permission, the export won't work.",
  },
  {
    text:
      'Inside this app there are several ways to send out your health data. The free ' +
      'trial lasts 7 days, and the premium version (a one-time fee) offers automated ' +
      'exports. Tare is not affiliated with this developer in any way, and you can find ' +
      'other ways to export your health data as JSON if you wish.',
  },
  {
    text:
      'You can export your workouts and upload them here, or point an automation at the ' +
      'address below. Here is an example of a Workouts automation that suits Tare. You ' +
      'can also create an automation for Health Metrics > Step Count to count your steps.',
    pictures: [
      { src: '/guide/hae-workouts-1.webp', alt: 'The Tare Workouts automation, top half' },
      { src: '/guide/hae-workouts-2.webp', alt: 'The Tare Workouts automation, bottom half' },
    ],
  },
]

// Android has a key and an upload like any other phone, and no guide yet.
const ANDROID_NOTE =
  'The Android guide is in development, but the ingest link and upload portal is still ' +
  'available. Android has not been fully tested and may show inaccurate numbers on Tare.'

const PLATFORM_LABEL: Record<Platform, string> = { iphone: 'iPhone', android: 'Android' }

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // Some browsers refuse the clipboard outside a secure page. The value is
      // on screen and selectable either way, which is what matters.
      setCopied(false)
    }
  }

  return (
    <div className="mb-3">
      <p className="t-micro mb-1">{label}</p>
      <p className="mb-2 break-all rounded-lg bg-surface-2 p-2 text-sm">{value}</p>
      <button type="button" className="t-btn" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function SyncDevice() {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [status, setStatus] = useState<SyncKey | null>(null)
  const [minted, setMinted] = useState<MintedKey | null>(null)
  const [failed, setFailed] = useState('')
  const [working, setWorking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [added, setAdded] = useState('')
  const [refused, setRefused] = useState('')
  // The two questions this screen asks before acting.
  const [asking, setAsking] = useState(false)
  const [wiping, setWiping] = useState(false)
  const [wiped, setWiped] = useState('')
  // The guide picture opened big, or none.
  const [enlarged, setEnlarged] = useState<Picture | null>(null)
  const field = useId()
  // The last-sync line is a stamp, so it redraws when the clock changes.
  useClock()

  useEffect(() => {
    let alive = true
    api<SyncKey>('/account/ingest-token')
      .then((row) => alive && setStatus(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  const make = async () => {
    setAsking(false)
    setWorking(true)
    setFailed('')
    try {
      const row = await api<MintedKey>('/account/ingest-token', { method: 'POST' })
      setMinted(row)
      setStatus(row)
    } catch (failure) {
      setFailed(errorText(failure))
    }
    setWorking(false)
  }

  const take = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so picking the same file twice still fires.
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setAdded('')
    setRefused('')
    try {
      const counts = await uploadFile<Synced>('/ingest/upload', file)
      const skipped = counts.skipped > 0 ? ` ${counts.skipped} already synced.` : ''
      setAdded(`Added ${counts.days} days and ${counts.workouts} workouts.${skipped}`)
      // Something came from a file, so the way back out of that is now offered.
      setStatus((current) => (current === null ? current : { ...current, uploaded: true }))
    } catch (failure) {
      setRefused(errorText(failure))
    }
    setUploading(false)
  }

  const wipe = async () => {
    setWiping(false)
    setFailed('')
    try {
      const answer = await api<Removed>('/ingest/uploads', { method: 'DELETE' })
      setWiped(`Removed ${answer.removed} uploaded readings.`)
      setAdded('')
      setStatus((current) => (current === null ? current : { ...current, uploaded: false }))
    } catch (failure) {
      setFailed(errorText(failure))
    }
  }

  // Only once there is something to take away, and never gated on whether
  // uploads are still switched on: what is already here has to be removable.
  const wipeRow = status?.uploaded === true && (
    <div className="t-card mb-3">
      <button
        type="button"
        className="t-row w-full text-left text-sm text-danger"
        onClick={() => setWiping(true)}
      >
        Remove everything I uploaded
      </button>
      {wiped !== '' && <p className="mt-2 text-sm text-muted">{wiped}</p>}
    </div>
  )

  const prompts = (
    <>
      <ConfirmSheet
        open={asking}
        label="New sync key"
        question="Make a new sync key?"
        note="The old key stops working; put the new one in your export app."
        verb="Make a new key"
        danger={false}
        busy={working}
        onConfirm={make}
        onClose={() => setAsking(false)}
      />
      <ConfirmSheet
        open={wiping}
        label="Remove uploads"
        question="Remove every number that came from a file?"
        note="Synced data stays."
        verb="Remove"
        onConfirm={wipe}
        onClose={() => setWiping(false)}
      />
    </>
  )

  const address = `${window.location.origin}${status?.path ?? '/api/ingest/health'}`

  if (platform === null) {
    return (
      <>
        <div className="t-card mb-3">
          <p className="text-sm">{WHAT_THIS_IS}</p>
          {status?.connected === true ? (
            <p className="mt-2 text-sm text-muted">
              {status.last_used_at === null
                ? 'Key created, nothing received yet.'
                : `Connected. Last health data sync: ${stampText(status.last_used_at)}.`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Nothing is sent from Tare to your phone. Your phone posts to Tare on a
              schedule you pick.
            </p>
          )}
        </div>
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Pick a device</p>
          <button
            type="button"
            className="t-option w-full"
            onClick={() => setPlatform('iphone')}
          >
            iPhone
          </button>
          <button
            type="button"
            className="t-option w-full"
            onClick={() => setPlatform('android')}
          >
            Android
          </button>
        </div>
        {wipeRow}
        {failed !== '' && <p className="t-error">{failed}</p>}
        {prompts}
      </>
    )
  }

  return (
    <>
      <div className="t-card mb-3">
        <p className="t-micro mb-2">{PLATFORM_LABEL[platform]} guide</p>
        {platform === 'android' ? (
          <p className="text-sm text-muted">{ANDROID_NOTE}</p>
        ) : (
          <ol className="ml-4 list-decimal text-sm">
            {IPHONE_STEPS.map((step) => (
              <li key={step.text} className="mb-3">
                {step.text}
                {step.pictures !== undefined && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.pictures.map((picture) => (
                      <button
                        key={picture.src}
                        type="button"
                        className="max-w-[12rem] overflow-hidden rounded-lg bg-surface-2"
                        aria-label={`Open ${picture.alt}`}
                        onClick={() => setEnlarged(picture)}
                      >
                        <img src={picture.src} alt={picture.alt} loading="lazy" className="w-full" />
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {enlarged !== null && (
        <Lightbox src={enlarged.src} alt={enlarged.alt} onClose={() => setEnlarged(null)} />
      )}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Your sync key</p>
        {minted === null ? (
          <>
            <p className="mb-3 text-sm text-muted">
              {status?.connected === true ? ALREADY_MADE : SHOWN_ONCE}
            </p>
            <button
              type="button"
              className="t-btn t-btn-primary"
              disabled={working}
              onClick={() => (status?.connected === true ? setAsking(true) : void make())}
            >
              <KeyRound className="h-4 w-4" strokeWidth={2} />
              {status?.connected === true ? 'New key' : 'Make my sync key'}
            </button>
          </>
        ) : (
          <>
            <CopyRow label="Send to" value={address} />
            <CopyRow label="Authorization header" value={`Bearer ${minted.token}`} />
            <p className="text-xs text-muted">
              This is the only time the key is shown. If you lose it, come back and make a
              new one.
            </p>
          </>
        )}
        {failed !== '' && <p className="t-error mt-2">{failed}</p>}
      </div>

      {/* An instance can be set to take no files at all, and then there is
          nothing to offer here. */}
      {status?.uploads !== false && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Upload an export</p>
          <p className="mb-3 text-sm text-muted">
            Export the last 30 days from Health Auto Export as JSON and pick the file here.
            Anything already synced is skipped. Files up to 15 MB.
          </p>
          <label className="t-btn cursor-pointer" htmlFor={field}>
            {uploading ? 'Uploading.' : 'Choose a file'}
          </label>
          <input
            id={field}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            disabled={uploading}
            onChange={take}
          />
          {added !== '' && <p className="mt-2 text-sm">{added}</p>}
          {refused !== '' && <p className="t-error mt-2">{refused}</p>}
        </div>
      )}

      {wipeRow}

      <div className="t-card mb-3">
        <button type="button" className="t-btn w-full" onClick={() => setPlatform(null)}>
          Pick a different phone
        </button>
      </div>
      {prompts}
    </>
  )
}
