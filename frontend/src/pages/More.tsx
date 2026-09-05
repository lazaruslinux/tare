import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  Eye,
  HeartPulse,
  IdCard,
  Inbox,
  Info,
  Mail,
  MessageSquare,
  Monitor,
  ScrollText,
  Smartphone,
  Target,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Me, type SyncKey, type Units } from '../api'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { type Glyph } from '../components/TabBar'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { useTopBar, type TopBarHeader } from '../hooks/useTopBar'
import { useRailLayout } from '../hooks/useWideLayout'
import { type Clock } from '../lib/clock'
import { today } from '../lib/day'
import { ZONES, offList } from '../lib/zones'
import { applyTheme, rememberTheme, useTheme, type Theme } from '../theme'
import { About } from './About'
import { AdminInvites } from './AdminInvites'
import { AdminQueue } from './AdminQueue'
import { AdminUploads } from './AdminUploads'
import { AdminUsers } from './AdminUsers'
import { Feedback, FeedbackLog } from './Feedback'
import { Fitness } from './Fitness'
import { Guide } from './Guide'
import { Members } from './Members'
import { MemberView } from '../components/MemberView'
import { Profile } from './Profile'
import { Sharing } from './Sharing'
import { Submissions } from './Submissions'
import { SyncDevice } from './SyncDevice'
import { Targets } from './Targets'
import { ScaleGlyph } from '../components/ScaleGlyph'

// Everything that is not a tab of its own, as a list of screens. Each row
// opens one, and the screen it opens names the way back here. The last three
// are only any use to an administrator, and only they are offered them.
export type Screen =
  | 'account'
  | 'profile'
  | 'targets'
  | 'fitness'
  | 'sync'
  | 'sharing'
  | 'members'
  | 'submissions'
  | 'display'
  | 'feedback'
  | 'guide'
  | 'about'
  | 'queue'
  | 'invites'
  | 'users'
  | 'uploads'
  | 'feedbacklog'
  | null

// Short enough to sit in the row without the select clipping it, and the
// system is named so the abbreviations are not the only clue.
const UNITS: { value: Units; label: string }[] = [
  { value: 'imperial', label: 'Imperial (lb, oz)' },
  { value: 'metric', label: 'Metric (g, ml)' },
]

// Which clock times are read on. Twelve hours first: it is the default and
// what nearly everybody here reads.
const CLOCKS: { value: Clock; label: string }[] = [
  { value: '12h', label: '12-hour' },
  { value: '24h', label: '24-hour' },
]

// What the sync row says under itself, or nothing at all before a key exists.
function syncNote(row: SyncKey | null): string | undefined {
  if (row === null || !row.connected) return undefined
  return row.last_used_at === null ? 'Key created, nothing received yet' : 'Connected'
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function Row({
  label,
  icon: Icon,
  count,
  note,
  onOpen,
}: {
  label: string
  icon: Glyph
  count?: number
  // What this row is already showing, said under it. Only the rows that have
  // something to report carry one.
  note?: string
  onOpen: () => void
}) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {note !== undefined && <span className="block text-xs text-muted">{note}</span>}
      </span>
      {count !== undefined && count > 0 && <span className="t-chip t-nums">{count}</span>}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
    </button>
  )
}

export function More({
  me,
  onChange,
  onSignedOut,
  waiting,
  refresh,
  onReviewed,
  onChanged,
  onOpenBiometrics,
  onOpenFood,
  start,
  onStarted,
  onScreen,
}: {
  me: Me
  onChange: (me: Me) => void
  onSignedOut: () => void
  // How many submissions are waiting. Read once above this screen, because the
  // navigation says the same number.
  waiting: number
  // The app-wide change tick. What this tab reads from the server is read
  // again on every bump, so a screen left open catches up on its own.
  refresh: number
  // The badge is worth asking about again: said on the way out of an admin
  // screen, and after somebody reads the answers to their own submissions.
  onReviewed: () => void
  // Something under this tab changed on the server, and the other tabs list it
  // too.
  onChanged: () => void
  // The weigh-ins live on the Progress screen under the Dashboard, so this row
  // opens that rather than holding a second copy of the same history.
  onOpenBiometrics: () => void
  // A food a submission is about, opened on the tab it lives on.
  onOpenFood: (foodId: number) => void
  // Which screen to open on. Only ever set by something outside this tab
  // sending somebody straight to it, and handed back the moment it is read.
  start?: Screen
  onStarted?: () => void
  // Which screen this tab is on, said upward so the rail can light the row
  // that leads to it.
  onScreen?: (screen: Screen) => void
}) {
  const theme = useTheme()
  // At rail width the rail already lists Targets and Fitness, so this list
  // does not say them twice.
  const railed = useRailLayout()
  const [screen, setScreen] = useState<Screen>(start ?? null)
  // What the sync row says under itself. One request when this tab opens, and
  // nothing after that: it is a line on a row, not a live figure.
  const [sync, setSync] = useState<SyncKey | null>(null)
  const [measuring, setMeasuring] = useState(false)
  // Which member's profile is open on the Members screen, if any.
  const [member, setMember] = useState<number | null>(null)

  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const [units, setUnits] = useState<Units>(me.units)
  const [clock, setClock] = useState<Clock>(me.clock)
  const [timezone, setTimezone] = useState(me.timezone)
  const [accountError, setAccountError] = useState('')
  const [accountSaved, markAccountSaved] = useSavedChip()
  const [savingAccount, setSavingAccount] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, markPasswordSaved] = useSavedChip()
  const [savingPassword, setSavingPassword] = useState(false)

  useEffect(() => {
    let alive = true
    api<SyncKey>('/account/ingest-token')
      .then((row) => alive && setSync(row))
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // The screen as well as the tick: coming back from Sync a device is where
    // the line under that row is most likely to be out of date.
  }, [refresh, screen])


  // What was said about the last save belongs to the screen it was said on.
  const go = (next: Screen) => {
    setAccountError('')
    setMember(null)
    setScreen(next)
  }

  // The two screens written here name themselves; the admin ones name
  // themselves from inside, and the list is the root.
  const back = { label: 'More', onBack: () => go(null) }
  // Targets names itself from inside, because it holds three screens of its
  // own and each of them is a level deeper than this list.
  const NAMED: Partial<Record<NonNullable<Screen>, string>> = {
    account: 'Account',
    profile: 'Profile',
    display: 'Display',
    sync: 'Health data sync',
    feedback: 'Send feedback',
    guide: 'Guide',
    about: 'About',
    feedbacklog: 'Feedback log',
  }
  const named = screen === null ? null : NAMED[screen]
  const header: TopBarHeader | null =
    screen === null
      ? { title: 'More', left: 'title', subtitle: me.display_name || me.username }
      : named === undefined || named === null
        ? null
        : { title: named, back }
  useTopBar(header)

  // A screen asked for from outside is opened once, and then this tab owns
  // where it is again.
  useEffect(() => {
    if (start === undefined || start === null) return
    setScreen(start)
    onStarted?.()
  }, [start, onStarted])

  useEffect(() => {
    onScreen?.(screen)
    // Leaving the tab leaves nothing behind for the rail to light.
    return () => onScreen?.(null)
  }, [screen, onScreen])

  // The name is edited on one screen and the two server-side preferences on
  // another, but they are one record and one request either way.
  const nameDirty = displayName !== (me.display_name ?? '')
  const displayDirty = units !== me.units || clock !== me.clock || timezone !== me.timezone

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault()
    setSavingAccount(true)
    setAccountError('')
    try {
      onChange(
        await api<Me>('/account', {
          method: 'PATCH',
          body: { display_name: displayName, units, clock, timezone },
        })
      )
      markAccountSaved()
    } catch (failure) {
      setAccountError(errorText(failure))
    }
    setSavingAccount(false)
  }

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    setSavingPassword(true)
    setPasswordError('')
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      })
      setCurrentPassword('')
      setNewPassword('')
      markPasswordSaved()
    } catch (failure) {
      setPasswordError(errorText(failure))
    }
    setSavingPassword(false)
  }

  const chooseTheme = (next: Theme) => {
    applyTheme(next)
    rememberTheme(next)
  }

  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // The cookie is the session, and the browser has let go of it either
      // way. Nothing here should keep somebody on a screen they have left.
    }
    onSignedOut()
  }

  const leaveAdmin = () => {
    go(null)
    onReviewed()
  }
  if (screen === 'profile') {
    return (
      <>
        <Profile me={me} onChange={onChange} onAddMeasurement={() => setMeasuring(true)} />
        {measuring && (
          <MeasurementsSheet
            me={me}
            date={today(me.timezone)}
            onClose={() => setMeasuring(false)}
            onSaved={() => setMeasuring(false)}
          />
        )}
      </>
    )
  }

  if (screen === 'targets') {
    return (
      <Targets
        me={me}
        onBack={() => go(null)}
        onOpenProfile={() => go('profile')}
        onOpenGuide={() => go('guide')}
      />
    )
  }

  if (screen === 'guide') return <Guide />

  if (screen === 'about') return <About onOpenGuide={() => go('guide')} />

  if (screen === 'feedback') {
    return (
      <Feedback onSent={() => go(null)} />
    )
  }

  if (screen === 'fitness') {
    return (
      <Fitness
        me={me}
        refresh={refresh}
        onBack={() => go(null)}
        onOpenSync={() => go('sync')}
      />
    )
  }

  if (screen === 'members') {
    return member === null ? (
      <Members me={me.id} onBack={() => go(null)} onOpen={setMember} />
    ) : (
      <MemberView userId={member} back="Members" onBack={() => setMember(null)} />
    )
  }

  if (screen === 'sharing') {
    return <Sharing me={me} onChange={onChange} onBack={() => go(null)} />
  }

  if (screen === 'submissions') {
    return (
      <Submissions
        me={me}
        refresh={refresh}
        onBack={() => go(null)}
        onOpenFood={onOpenFood}
        onSeen={onReviewed}
        onChanged={onChanged}
      />
    )
  }

  if (screen === 'sync') return <SyncDevice />

  if (screen === 'feedbacklog') return <FeedbackLog />

  if (screen === 'queue') {
    return <AdminQueue refresh={refresh} onBack={leaveAdmin} onDecided={onReviewed} />
  }
  if (screen === 'invites') return <AdminInvites onBack={leaveAdmin} />
  if (screen === 'users') return <AdminUsers onBack={leaveAdmin} />
  if (screen === 'uploads') return <AdminUploads onBack={() => go(null)} />

  if (screen === 'account') {
    return (
      <>
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Email</p>
          <p className="text-sm">{me.email ?? 'Not set'}</p>
          <p className="mt-2 text-xs text-muted">
            Used to sign in and to reset your password. Never sold, never added to a list.
          </p>
        </div>

        <form className="t-card mb-3" onSubmit={saveAccount}>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-display-name">
              Display name
            </label>
            <input
              id="settings-display-name"
              className="t-input max-w-[55%]"
              autoComplete="nickname"
              placeholder={me.username}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          {accountError && <p className="t-error mt-3">{accountError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              className="t-btn t-btn-primary"
              type="submit"
              disabled={!nameDirty || savingAccount}
            >
              Save
            </button>
            <SaveMarks dirty={nameDirty} saved={accountSaved} />
          </div>
        </form>

        <form className="t-card mb-3" onSubmit={savePassword}>
          <p className="t-micro mb-2">Password</p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="t-label" htmlFor="settings-current-password">
                Current password
              </label>
              <input
                id="settings-current-password"
                className="t-input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div>
              <label className="t-label" htmlFor="settings-new-password">
                New password
              </label>
              <input
                id="settings-new-password"
                className="t-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
          </div>
          {passwordError && <p className="t-error mt-3">{passwordError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              className="t-btn t-btn-primary"
              type="submit"
              disabled={!currentPassword || !newPassword || savingPassword}
            >
              Change password
            </button>
            <SaveMarks dirty={false} saved={passwordSaved} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Changing this signs out every other device and leaves this one signed in.
          </p>
        </form>
      </>
    )
  }

  if (screen === 'display') {
    return (
      <>
        <form className="t-card mb-3" onSubmit={saveAccount}>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-units">
              Units
            </label>
            <select
              id="settings-units"
              className="t-input max-w-[55%]"
              value={units}
              onChange={(event) => setUnits(event.target.value as Units)}
            >
              {UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-clock">
              Time format
            </label>
            <select
              id="settings-clock"
              className="t-input max-w-[55%]"
              value={clock}
              onChange={(event) => setClock(event.target.value as Clock)}
            >
              {CLOCKS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-timezone">
              Time zone
            </label>
            <select
              id="settings-timezone"
              className="t-input max-w-[55%]"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {/* An account made before this list keeps working, and says so
                  once, until it is moved onto one of the seven. */}
              {offList(me.timezone) && (
                <option value={me.timezone}>Current: {me.timezone}</option>
              )}
              {ZONES.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </div>
          {accountError && <p className="t-error mt-3">{accountError}</p>}
          <div className="mt-3 flex items-center gap-3">
            <button
              className="t-btn t-btn-primary"
              type="submit"
              disabled={!displayDirty || savingAccount}
            >
              Save
            </button>
            <SaveMarks dirty={displayDirty} saved={accountSaved} />
          </div>
        </form>

        <div className="t-card mb-3">
          <div className="t-row">
            <span className="flex-1 text-sm">Theme</span>
            <div className="flex gap-2">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  className="t-btn px-3 aria-pressed:border-accent aria-pressed:text-text"
                  onClick={() => chooseTheme(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">Kept on this device.</p>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="t-card mb-3">
        <Row label="Account" icon={UserRound} onOpen={() => go('account')} />
        <Row label="Profile" icon={IdCard} onOpen={() => go('profile')} />
        {!railed && <Row label="Targets" icon={Target} onOpen={() => go('targets')} />}
        {!railed && <Row label="Fitness" icon={HeartPulse} onOpen={() => go('fitness')} />}
        {!railed && <Row label="Biometrics" icon={ScaleGlyph} onOpen={onOpenBiometrics} />}
        <Row
          label="Health data sync"
          icon={Smartphone}
          note={syncNote(sync)}
          onOpen={() => go('sync')}
        />
        <Row label="Members" icon={Users} onOpen={() => go('members')} />
        <Row
          label="Sharing"
          icon={Eye}
          note="What other members can see"
          onOpen={() => go('sharing')}
        />
        <Row label="Display" icon={Monitor} onOpen={() => go('display')} />
        <Row label="Send feedback" icon={MessageSquare} onOpen={() => go('feedback')} />
        <Row label="Guide" icon={BookOpen} onOpen={() => go('guide')} />
        <Row label="About" icon={Info} onOpen={() => go('about')} />
        <Row label="My submissions" icon={Inbox} onOpen={() => go('submissions')} />
      </div>

      {me.is_admin && (
        <>
          <p className="t-micro mb-1">Administration</p>
          <div className="t-card mb-3">
            <Row
              label="Review queue"
              icon={ClipboardList}
              count={waiting}
              onOpen={() => go('queue')}
            />
            <Row label="Invites" icon={Mail} onOpen={() => go('invites')} />
            <Row label="Member accounts" icon={Users} onOpen={() => go('users')} />
            <Row label="Uploads" icon={Upload} onOpen={() => go('uploads')} />
            <Row label="Feedback log" icon={ScrollText} onOpen={() => go('feedbacklog')} />
          </div>
        </>
      )}

      <div className="t-card mb-3">
        <button className="t-btn w-full" type="button" onClick={signOut}>
          Sign out
        </button>
      </div>

    </>
  )
}
