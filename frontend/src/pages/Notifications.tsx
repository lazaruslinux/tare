import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'

import {
  api,
  ApiError,
  errorText,
  type Me,
  type NotifyPrefs,
  type PushDevices,
  type PushKey,
  type PushSubscriptionRow,
} from '../api'
import { TimeCombo } from '../components/calendar/TimeCombo'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useInstantSave } from '../components/SaveMarks'
import { Switch } from '../components/Switch'
import { useTopBar } from '../hooks/useTopBar'
import { dateText } from '../lib/clock'
import { currentSubscription, subscribe, support, unsubscribe, type PushSupport } from '../lib/push'

// What arrives on a phone, and which of the phones signed in to this account
// it arrives on. Each device is turned on where it is held; the switches below
// say what would be sent to any of them, and save themselves as they are
// turned.

// The two lead times the server will accept, and nothing between them.
const MINUTES = [15, 30]

// Monday first, and numbered the way the server counts a weekday.
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

const NOT_SET_UP = 'Notifications are not set up on this instance.'
const FOR_THE_ADMIN = 'Mint keys with the manage command and add them to the environment.'
const CANNOT = 'This browser cannot show notifications from a web app.'
const NEEDS_INSTALL =
  'On iPhone, notifications need Tare on the Home Screen. Tap Share, then Add to Home Screen, then come back here.'
const BLOCKED =
  'Notifications are blocked for Tare in your browser settings. Allow them there, then come back.'
const FAILED = 'Could not turn notifications on. Try again.'
const RELOAD = 'Reload once, then try again.'

export function Notifications({
  me,
  push,
  onChange,
  onBack,
}: {
  me: Me
  // Whether the instance holds the keys a notification is signed with. Without
  // them nothing can be sent, so the screen says so and offers nothing.
  push: boolean
  onChange: (me: Me) => void
  onBack: () => void
}) {
  const [prefs, setPrefs] = useState<NotifyPrefs>(me.notify)
  // What this browser can do, read once: the answer only changes by leaving
  // the app and coming back to it.
  const [can, setCan] = useState<PushSupport>(() => support())
  // This device's own subscription, and the rows the server holds. The two
  // together are what says whether this device is on.
  const [sub, setSub] = useState<PushSubscription | null>(null)
  const [devices, setDevices] = useState<PushSubscriptionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [deviceError, setDeviceError] = useState('')
  const [tested, setTested] = useState('')
  // The device a Remove is asking about, or null.
  const [removing, setRemoving] = useState<PushSubscriptionRow | null>(null)
  const [removeError, setRemoveError] = useState('')
  const checkinsSave = useInstantSave()
  const weighSave = useInstantSave()
  const calendarSave = useInstantSave()

  useTopBar({ title: 'Notifications', back: { label: 'More', onBack } })

  const loadDevices = async () => {
    const answer = await api<PushDevices>('/push/subscriptions')
    setDevices(answer.devices)
  }

  useEffect(() => {
    if (!push) return
    let alive = true
    // Never awaited before the screen draws: under the dev server there is no
    // worker at all and this promise never settles.
    currentSubscription()
      .then((held) => alive && setSub(held))
      .catch(() => undefined)
    loadDevices().catch((failure) => alive && setDeviceError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [push])

  if (!push) {
    return (
      <div className="t-card mb-3">
        <p className="text-sm text-muted">{NOT_SET_UP}</p>
        {me.is_admin && <p className="mt-2 text-sm text-muted">{FOR_THE_ADMIN}</p>}
      </div>
    )
  }

  // The row the push service handed this browser, if the server still holds
  // it. Both halves have to agree before the card says this device is on.
  const mine = sub === null ? undefined : devices.find((row) => row.endpoint === sub.endpoint)

  // The whole object, every time: the server holds one answer and the screen
  // saves what it is showing rather than a field of it.
  const patch = (
    run: (save: () => Promise<void>) => void,
    next: NotifyPrefs,
    undo: NotifyPrefs
  ) => {
    setPrefs(next)
    run(async () => {
      try {
        onChange(await api<Me>('/account', { method: 'PATCH', body: { notify: next } }))
      } catch (failure) {
        setPrefs(undo)
        throw failure
      }
    })
  }

  const turnOn = async () => {
    setBusy(true)
    setDeviceError('')
    setTested('')
    try {
      // A page the worker does not control yet cannot rely on it being
      // installed, so wait for the registration before asking for anything.
      if (navigator.serviceWorker.controller === null) await navigator.serviceWorker.ready
      const { key } = await api<PushKey>('/push/key')
      const json = await subscribe(key)
      await api<PushSubscriptionRow>('/push/subscriptions', { method: 'POST', body: json })
      setSub(await currentSubscription())
      await loadDevices()
    } catch (failure) {
      if (failure instanceof ApiError) setDeviceError(failure.detail)
      else if (navigator.serviceWorker.controller === null) setDeviceError(RELOAD)
      else setDeviceError(FAILED)
      // A prompt somebody refused turns this card into the blocked state.
      setCan(support())
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    setDeviceError('')
    setTested('')
    try {
      const endpoint = await unsubscribe()
      const row = devices.find((each) => each.endpoint === endpoint)
      if (row !== undefined) await api(`/push/subscriptions/${row.id}`, { method: 'DELETE' })
      setSub(null)
      await loadDevices()
    } catch (failure) {
      setDeviceError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  const sendTest = async () => {
    setBusy(true)
    setDeviceError('')
    setTested('')
    try {
      const answer = await api<{ sent: number }>('/push/test', { method: 'POST' })
      setTested(`Sent to ${answer.sent} ${answer.sent === 1 ? 'device' : 'devices'}.`)
    } catch (failure) {
      setDeviceError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: PushSubscriptionRow) => {
    setBusy(true)
    setRemoveError('')
    try {
      await api(`/push/subscriptions/${row.id}`, { method: 'DELETE' })
      if (sub !== null && row.endpoint === sub.endpoint) {
        await unsubscribe().catch(() => undefined)
        setSub(null)
      }
      await loadDevices()
      setRemoving(null)
    } catch (failure) {
      setRemoveError(errorText(failure))
    } finally {
      setBusy(false)
    }
  }

  // A time control commits an empty string for text that is not a time. The
  // slot keeps the hour it had rather than saving a blank one.
  const setTime = (slot: 'morning' | 'evening', next: string) => {
    if (next === '') return
    if (next === prefs[slot].time) return
    patch(checkinsSave.run, { ...prefs, [slot]: { ...prefs[slot], time: next } }, prefs)
  }

  const showMorningTime = prefs.morning.on || prefs.weigh_in.on
  // This device has a card of its own above, so the list underneath is the
  // rest of them. Listing it twice was the screen's one contradiction.
  const others = devices.filter((row) => sub === null || row.endpoint !== sub.endpoint)

  return (
    <>
      <p className="t-micro mb-1">This device</p>
      <div className="t-card mb-3">
        {can === 'unsupported' && <p className="text-sm text-muted">{CANNOT}</p>}
        {can === 'needs-install' && <p className="text-sm text-muted">{NEEDS_INSTALL}</p>}
        {can === 'blocked' && <p className="text-sm text-muted">{BLOCKED}</p>}
        {can === 'off' && mine === undefined && (
          <>
            <p className="text-sm text-muted">Nothing arrives on this device yet.</p>
            <button
              type="button"
              className="t-btn t-btn-primary mt-3 w-full sm:w-auto sm:min-w-[16rem]"
              disabled={busy}
              onClick={() => void turnOn()}
            >
              Turn on notifications
            </button>
            <p className="mt-2 text-xs text-muted">
              Each phone or computer is turned on separately.
            </p>
          </>
        )}
        {can === 'off' && mine !== undefined && (
          <>
            <p className="text-sm">This device gets notifications.</p>
            <div className="mt-3 flex gap-3 sm:justify-start">
              <button
                type="button"
                className="t-btn flex-1 sm:max-w-[12rem] sm:flex-none"
                disabled={busy}
                onClick={() => void sendTest()}
              >
                Send a test
              </button>
              <button
                type="button"
                className="t-btn flex-1 sm:max-w-[12rem] sm:flex-none"
                disabled={busy}
                onClick={() => void turnOff()}
              >
                Turn off
              </button>
            </div>
          </>
        )}
        {tested !== '' && <p className="mt-2 text-sm text-muted">{tested}</p>}
        {deviceError !== '' && <p className="t-error mt-2">{deviceError}</p>}
      </div>

      <p className="t-micro mb-1">Other devices</p>
      <div className="t-card mb-3">
        {others.length === 0 ? (
          <p className="text-sm text-muted">No other device is turned on.</p>
        ) : (
          others.map((row) => (
            <div key={row.id} className="t-row">
              {/* Two lines by design: the name on its own, and when it was
                  added under it, so the row never wraps by accident. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{row.label}</span>
                <span className="block text-xs text-muted">
                  added {dateText(row.created_at)}
                </span>
              </span>
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-danger"
                onClick={() => {
                  setRemoveError('')
                  setRemoving(row)
                }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Check-ins</p>
        {checkinsSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <Switch
          label="Morning check-in"
          note="A note to start your day, and your first appointment. If it's your weigh-in day, you'll also be reminded here."
          checked={prefs.morning.on}
          onChange={(next) =>
            patch(checkinsSave.run, { ...prefs, morning: { ...prefs.morning, on: next } }, prefs)
          }
        />
        {/* The weigh-in note goes out at the morning hour too, so the hour is
            still on offer when the morning check-in itself is off. */}
        <Fold shown={showMorningTime}>
          <TimeCombo
            id="notify-morning"
            label="Morning time"
            beside
            value={prefs.morning.time}
            onChange={(next) => setTime('morning', next)}
          />
        </Fold>
        <Switch
          label="Evening check-in"
          note="A reminder to finish your journal for the day."
          checked={prefs.evening.on}
          onChange={(next) =>
            patch(checkinsSave.run, { ...prefs, evening: { ...prefs.evening, on: next } }, prefs)
          }
        />
        <Fold shown={prefs.evening.on}>
          <TimeCombo
            id="notify-evening"
            label="Evening time"
            beside
            value={prefs.evening.time}
            onChange={(next) => setTime('evening', next)}
          />
        </Fold>
        <Switch
          label="Weekly check-in"
          note="After 7 days of inactivity, daily notifications will pause."
          checked={prefs.weekly.on}
          onChange={(next) =>
            patch(checkinsSave.run, { ...prefs, weekly: { on: next } }, prefs)
          }
        />
        {checkinsSave.error && <p className="t-error mt-2">{checkinsSave.error}</p>}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Weekly weigh-in</p>
        {weighSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <Switch
          label="Weekly weigh-in"
          note="Tare recommends weekly weigh-ins, not daily. Select this to get a reminder once a week."
          checked={prefs.weigh_in.on}
          onChange={(next) =>
            patch(weighSave.run, { ...prefs, weigh_in: { ...prefs.weigh_in, on: next } }, prefs)
          }
        />
        <Fold shown={prefs.weigh_in.on}>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="notify-weekday">
              Weigh-in day
            </label>
            <select
              id="notify-weekday"
              className="t-input max-w-[55%]"
              value={prefs.weigh_in.weekday}
              onChange={(event) =>
                patch(
                  weighSave.run,
                  {
                    ...prefs,
                    weigh_in: { ...prefs.weigh_in, weekday: Number(event.target.value) },
                  },
                  prefs
                )
              }
            >
              {WEEKDAYS.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </div>
        </Fold>
        {weighSave.error && <p className="t-error mt-2">{weighSave.error}</p>}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Calendar</p>
        {calendarSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        {/* What this member arranged, and what other people did to it: two
            different questions, so they are asked apart. */}
        <p className="t-micro mb-1">Personal</p>
        <Switch
          label="Appointment reminders"
          checked={prefs.reminders.on}
          onChange={(next) =>
            patch(
              calendarSave.run,
              { ...prefs, reminders: { ...prefs.reminders, on: next } },
              prefs
            )
          }
        />
        <Fold shown={prefs.reminders.on}>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="notify-minutes">
              Time before
            </label>
            <select
              id="notify-minutes"
              className="t-input max-w-[55%]"
              value={prefs.reminders.minutes}
              onChange={(event) =>
                patch(
                  calendarSave.run,
                  {
                    ...prefs,
                    reminders: { ...prefs.reminders, minutes: Number(event.target.value) },
                  },
                  prefs
                )
              }
            >
              {MINUTES.map((each) => (
                <option key={each} value={each}>
                  {each} min
                </option>
              ))}
            </select>
          </div>
        </Fold>
        <p className="t-micro mt-3 mb-1">Shared</p>
        <Switch
          label="Calendar updates"
          note="Changes on calendars you share, invitations, the answers to yours, and a calendar offered to you."
          checked={prefs.calendar}
          onChange={(next) => patch(calendarSave.run, { ...prefs, calendar: next }, prefs)}
        />
        {calendarSave.error && <p className="t-error mt-2">{calendarSave.error}</p>}
      </div>

      <ConfirmSheet
        open={removing !== null}
        label="Remove device"
        question={removing === null ? '' : `Remove ${removing.label}?`}
        note="It stops getting notifications until it is turned on again."
        verb="Remove"
        busy={busy}
        error={removeError === '' ? null : removeError}
        onConfirm={() => removing !== null && void remove(removing)}
        onClose={() => setRemoving(null)}
      />
    </>
  )
}

// A fold that clips only while it moves. Once open it lets the time control's
// list hang below it; a hidden overflow would cut that list to a sliver.
function Fold({ shown, children }: { shown: boolean; children: ReactNode }) {
  const reduced = useReducedMotion()
  const [moving, setMoving] = useState(false)
  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          style={{ overflow: moving ? 'hidden' : 'visible' }}
          initial={reduced ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={reduced ? undefined : { height: 0, opacity: 0 }}
          transition={{ duration: 0.18 }}
          onAnimationStart={() => setMoving(true)}
          onAnimationComplete={() => setMoving(false)}
        >
          <div className="pt-2 pb-3">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
