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
import { Sheet } from '../components/Sheet'

type Platform = 'iphone' | 'android'

// What this screen is for, said once, to somebody who has never connected a
// phone to anything.
const WHAT_THIS_IS =
  'Tare takes the health data your phone exports and turns it into your ' +
  'dashboard and fitness plan: steps, calories, workouts and more. Setup is ' +
  'one time. Read the guide below.'

// The two things this screen asks before it does them. A new key silently
// breaking a working automation, and numbers going away, are both worth a
// question first.
// What the key card says, before there is a key and after there is one.
const SHOWN_ONCE =
  'The key is shown once. Copy both lines into your phone before you leave this screen.'
const ALREADY_MADE =
  "You've already created a key, which was only shown once. To make a new one, " +
  'click below. Creating a new key will disable the old one.'

const NEW_KEY_ASK =
  'This will create a new sync key that must be replaced in your export app. Continue?'
const WIPE_ASK = 'Remove every number that came from a file? Synced data stays.'

// When a key was last used, in the words the Fitness screen uses for it.
function lastSync(stamp: string): string {
  return new Date(stamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// What each phone needs, in the order somebody does it. Written for a person
// who has never set up an automation, so every step is one thing to do.
const STEPS: Record<Platform, string[]> = {
  iphone: [
    'Install Health Auto Export from the App Store and open it.',
    'Let it read Apple Health when it asks. Without that it has nothing to send.',
    'Go to Automations and add one. Set it to REST API, paste the address below into the URL, and add the header below.',
    'Set the data type to Workouts, turn on route data and workout metrics, and set it to run every 5 minutes.',
    'For the first run, set Date Range to Previous 30 days, run it once, then set it back to Default.',
    'Add a second automation the same way, with the data type set to Health Metrics. Turn on the readings you want Tare to keep. Tare stores all of them.',
    'Run each one once by hand. This screen will say connected within a minute.',
  ],
  android: [
    'Install HC Webhook and open it.',
    'Let it read Health Connect when it asks. Without that it has nothing to send.',
    'Paste the address below into its webhook URL and add the header below as a custom header.',
    'Turn on exercise sessions, heart rate, resting heart rate, active calories, steps, distance, weight and body fat.',
    'Set it to sync on an interval, 15 minutes.',
    'Run it once by hand. This screen will say connected within a minute.',
  ],
}

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
  const field = useId()

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
      <Sheet open={asking} label="New sync key" onClose={() => setAsking(false)}>
        <p className="text-sm">{NEW_KEY_ASK}</p>
        <div className="mt-4 flex gap-3">
          <button type="button" className="t-btn t-btn-primary flex-1" onClick={make}>
            Make a new key
          </button>
          <button type="button" className="t-btn" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
      <Sheet open={wiping} label="Remove uploads" onClose={() => setWiping(false)}>
        <p className="text-sm">{WIPE_ASK}</p>
        <div className="mt-4 flex gap-3">
          <button type="button" className="t-btn text-danger flex-1" onClick={wipe}>
            Remove
          </button>
          <button type="button" className="t-btn" onClick={() => setWiping(false)}>
            Cancel
          </button>
        </div>
      </Sheet>
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
                : `Connected. Last health data sync: ${lastSync(status.last_used_at)}.`}
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
        <p className="t-micro mb-2">{PLATFORM_LABEL[platform]}</p>
        <ol className="ml-4 list-decimal text-sm">
          {STEPS[platform].map((step) => (
            <li key={step} className="mb-2">
              {step}
            </li>
          ))}
        </ol>
      </div>

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
            Anything already synced is skipped.
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
