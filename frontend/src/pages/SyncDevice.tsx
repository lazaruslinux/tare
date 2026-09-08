import { ChevronDown, KeyRound } from 'lucide-react'
import { type ChangeEvent, useEffect, useId, useState } from 'react'

import {
  api,
  errorText,
  uploadFile,
  type Arrival,
  type MintedKey,
  type Removed,
  type Synced,
  type SyncKey,
  type Uploads,
} from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Lightbox } from '../components/Lightbox'
import { dateText, stampText, useClock } from '../lib/clock'

// What this screen is for, said once, to somebody who has never connected a
// phone to anything.
const WHAT_THIS_IS =
  'Tare takes the health data your phone exports and turns it into your ' +
  'Dashboard and Fitness screens: steps, calories, workouts and more. Setup ' +
  'is one time.'

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
// `text` is the key as well as the first words, so it stays a string; `bold`
// is the part of a step that is said louder.
type Step = { text: string; bold?: string; pictures?: Picture[] }

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
      'exports. ',
    bold:
      'Tare is not affiliated with this developer in any way, and you can find ' +
      'other ways to export your health data as JSON if you wish.',
  },
  {
    text:
      'Make two automations pointed at the address below, or export the files and upload ' +
      'them here. One with Data Type set to Workouts, like the example below. One more with ' +
      'Data Type set to Health Metrics, where you pick what Tare shows: Step Count, Active ' +
      'Energy, Walking + Running Distance, Apple Exercise Time and Resting Heart Rate. ' +
      'Everything else can stay unselected.',
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

// What a file is for, in his words, and which metrics the export needs.
const IMPORT_COPY =
  'If you do not wish to use the sync/automation feature, Tare accepts JSON files ' +
  '(up to 15 MB) containing exported Apple Health data. Android has not been tested. ' +
  'See the JSON format below.'
const METRICS_COPY =
  "Upload your 'Workouts' file and 'Health Metrics' file separately. The only Apple " +
  'Health Metrics Tare currently looks for are: Step Count, Active Energy, Walking + ' +
  'Running Distance, Apple Exercise Time and Resting Heart Rate. Everything else can ' +
  'stay unselected when creating your export. Tare plans to add more insights in the ' +
  'future.'

// How many recent imports show before the member asks for more.
const RECENT_PAGE = 5

// The smallest file this parser reads whole: one metric with two readings and
// one workout, with the dates written the way an export writes them.
const FILE_LAYOUT = `{
  "data": {
    "metrics": [
      {
        "name": "step_count",
        "units": "count",
        "data": [
          { "date": "2026-09-07 08:00:00 -0700", "qty": 4000 },
          { "date": "2026-09-07 18:00:00 -0700", "qty": 4500 }
        ]
      }
    ],
    "workouts": [
      {
        "name": "Outdoor Run",
        "start": "2026-09-07 17:12:00 -0700",
        "end": "2026-09-07 17:54:00 -0700",
        "activeEnergyBurned": { "qty": 431, "units": "kcal" },
        "distance": { "qty": 4.02, "units": "mi" }
      }
    ]
  }
}`

// What each arrival on the record is called on screen.
const ARRIVAL_LABEL: Record<Arrival['kind'], string> = {
  sync: 'From sync',
  upload: 'From upload',
  wipe: 'Removed uploads',
}

// What one arrival did. A wipe says it in its label and has nothing to add;
// a row from before the split was kept can only say how much it took.
// A count with its word: "1 workout", "9 readings".
const some = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function arrivalDetail(row: Arrival): string {
  if (row.kind === 'wipe') return ''
  const brought =
    row.days === null || row.workouts === null
      ? `${row.accepted} kept`
      : `${some(row.days, 'reading')}, ${some(row.workouts, 'workout')} added`
  const skipped = row.skipped > 0 ? ` · ${row.skipped} already synced` : ''
  const flagged = row.flagged > 0 ? ` · ${row.flagged} flagged` : ''
  return `${brought}${skipped}${flagged}`
}

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

// One figure on the uploads strip, in the Fitness tiles' shape: what it is,
// then the number.
function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`t-nums font-semibold ${small === true ? 'text-base' : 'text-2xl'}`}>
        {value}
      </p>
    </div>
  )
}

export function SyncDevice() {
  const [status, setStatus] = useState<SyncKey | null>(null)
  const [uploads, setUploads] = useState<Uploads | null>(null)
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
  // The two folds, both local and neither remembered: the guide once a phone
  // is connected, and the file layout.
  const [guideOpen, setGuideOpen] = useState(false)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [shown, setShown] = useState(RECENT_PAGE)
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
    api<Uploads>('/account/uploads')
      .then((row) => alive && setUploads(row))
      .catch(() => alive && setUploads(null))
    return () => {
      alive = false
    }
  }, [])

  // After anything that changes what is stored. A failure here leaves the card
  // out rather than putting a wrong figure on screen.
  const refreshUploads = () => {
    void api<Uploads>('/account/uploads')
      .then(setUploads)
      .catch(() => setUploads(null))
  }

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
      setAdded(`Added ${some(counts.days, 'reading')} and ${some(counts.workouts, 'workout')}.${skipped}`)
      // Something came from a file, so the way back out of that is now offered.
      setStatus((current) => (current === null ? current : { ...current, uploaded: true }))
      refreshUploads()
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
      refreshUploads()
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

  const steps = (
    <ol className="ml-4 list-decimal text-sm">
      {IPHONE_STEPS.map((step) => (
        <li key={step.text} className="mb-3">
          {step.text}
          {step.bold !== undefined && <strong>{step.bold}</strong>}
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
  )

  const covers =
    uploads === null || uploads.first_day === null || uploads.last_day === null
      ? '-'
      : uploads.first_day === uploads.last_day
        ? dateText(uploads.first_day)
        : `${dateText(uploads.first_day)} to ${dateText(uploads.last_day)}`

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

      {/* The guide is the whole screen until a phone is connected. After that
          it is a row somebody opens when they set up a second phone. */}
      {status?.connected === true ? (
        <div className="t-card mb-3">
          <button
            type="button"
            className="flex w-full items-center gap-3 text-left"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen(!guideOpen)}
          >
            <span className="min-w-0 flex-1 text-sm">Show the iPhone guide</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted ${guideOpen ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>
          {guideOpen && <div className="mt-3">{steps}</div>}
        </div>
      ) : (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">iPhone guide</p>
          {steps}
        </div>
      )}
      {enlarged !== null && (
        <Lightbox src={enlarged.src} alt={enlarged.alt} onClose={() => setEnlarged(null)} />
      )}

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Android</p>
        <p className="text-sm text-muted">{ANDROID_NOTE}</p>
      </div>

      <div className="t-card mb-3">
        <p className="t-micro mb-2">Automatic sync setup</p>
        {minted === null ? (
          <>
            <p className="mb-2 text-sm text-muted">
              For Health Auto Export or any app that can post JSON to an address on a
              schedule.
            </p>
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
          <p className="t-micro mb-2">Import health data</p>
          <p className="mb-2 text-sm text-muted">{IMPORT_COPY}</p>
          <p className="mb-3 text-sm text-muted">{METRICS_COPY}</p>
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
          <button
            type="button"
            className="mt-3 flex w-full items-center gap-3 text-left"
            aria-expanded={layoutOpen}
            onClick={() => setLayoutOpen(!layoutOpen)}
          >
            <span className="min-w-0 flex-1 text-sm">Show JSON format</span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted ${layoutOpen ? 'rotate-180' : ''}`}
              strokeWidth={2}
            />
          </button>
          {layoutOpen && (
            <>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-surface-2 p-2 text-[0.75rem]">
                {FILE_LAYOUT}
              </pre>
              <p className="mt-2 text-sm text-muted">
                A Health Connect bridge export is read too.
              </p>
            </>
          )}
        </div>
      )}

      {uploads !== null && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Your imports</p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Days synced" value={uploads.days_with_data.toLocaleString()} />
            <Stat label="Total workouts" value={uploads.workouts.toLocaleString()} />
            <Stat label="Date range of all imports" value={covers} small />
            <Stat
              label="Last received"
              value={
                uploads.last_received_at === null ? '-' : stampText(uploads.last_received_at)
              }
              small
            />
          </div>
          <p className="t-micro mt-3 mb-1">Recent</p>
          {uploads.recent.length === 0 ? (
            <p className="text-sm text-muted">Nothing has arrived yet.</p>
          ) : (
            uploads.recent.slice(0, shown).map((row, index) => {
              const detail = arrivalDetail(row)
              return (
                <div key={`${row.received_at}-${index}`} className="t-row flex-col items-stretch">
                  <p className="text-sm">
                    {stampText(row.received_at)} · {ARRIVAL_LABEL[row.kind]}
                    {detail !== '' && ` · ${detail}`}
                  </p>
                  {row.error !== null && (
                    <p className="mt-1 text-xs text-muted">{row.error}</p>
                  )}
                </div>
              )
            })
          )}
          {uploads.recent.length > shown && (
            <button
              type="button"
              className="t-btn mt-2"
              onClick={() => setShown(shown + RECENT_PAGE)}
            >
              Show {Math.min(RECENT_PAGE, uploads.recent.length - shown)} more
            </button>
          )}
          <p className="t-note mt-3">Tare keeps this list for 90 days.</p>
        </div>
      )}

      {wipeRow}
      {prompts}
    </>
  )
}
