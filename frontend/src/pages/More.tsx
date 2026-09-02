import {
  ChevronRight,
  ClipboardList,
  IdCard,
  Inbox,
  Mail,
  Monitor,
  Target,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Me, type Units } from '../api'
import { MeasurementsSheet } from '../components/MeasurementsSheet'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { useTopBar, type TopBarHeader } from '../hooks/useTopBar'
import { today } from '../lib/day'
import { applyTheme, rememberTheme, useTheme, type Theme } from '../theme'
import { AdminInvites } from './AdminInvites'
import { AdminQueue } from './AdminQueue'
import { AdminUsers } from './AdminUsers'
import { Profile } from './Profile'
import { Targets } from './Targets'

// Everything that is not a tab of its own, as a list of screens. Each row
// opens one, and the screen it opens names the way back here. The last three
// are only any use to an administrator, and only they are offered them.
export type Screen =
  | 'account'
  | 'profile'
  | 'targets'
  | 'display'
  | 'queue'
  | 'invites'
  | 'users'
  | null

// Short enough to sit in the row without the select clipping it, and the
// system is named so the abbreviations are not the only clue.
const UNITS: { value: Units; label: string }[] = [
  { value: 'imperial', label: 'Imperial (lb, oz)' },
  { value: 'metric', label: 'Metric (g, ml)' },
]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// Every zone the browser knows, which is the same list the account's own zone
// came from. Older browsers have no such call, and the account still has a
// zone, so it is offered on its own rather than an empty list.
function zones(current: string): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
  const all = supported ? supported('timeZone') : []
  return all.includes(current) ? all : [current, ...all]
}

function Row({
  label,
  icon: Icon,
  count,
  onOpen,
}: {
  label: string
  icon: LucideIcon
  count?: number
  onOpen: () => void
}) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
      <span className="flex-1 text-sm">{label}</span>
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
  onReviewed,
  onOpenSubmissions,
  start,
  onStarted,
}: {
  me: Me
  onChange: (me: Me) => void
  onSignedOut: () => void
  // How many submissions are waiting. Read once above this screen, because the
  // navigation says the same number.
  waiting: number
  // Said on the way out of an admin screen, so the count catches up with what
  // was just decided.
  onReviewed: () => void
  // What this account has offered lives on the Food tab beside the foods it
  // is about, so this row goes there rather than building a second screen for
  // the same list.
  onOpenSubmissions: () => void
  // Which screen to open on. Only ever set by something outside this tab
  // sending somebody straight to it, and handed back the moment it is read.
  start?: Screen
  onStarted?: () => void
}) {
  const theme = useTheme()
  const [screen, setScreen] = useState<Screen>(start ?? null)
  const [measuring, setMeasuring] = useState(false)

  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const [units, setUnits] = useState<Units>(me.units)
  const [timezone, setTimezone] = useState(me.timezone)
  const [accountError, setAccountError] = useState('')
  const [accountSaved, markAccountSaved] = useSavedChip()
  const [savingAccount, setSavingAccount] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, markPasswordSaved] = useSavedChip()
  const [savingPassword, setSavingPassword] = useState(false)

  // What was said about the last save belongs to the screen it was said on.
  const go = (next: Screen) => {
    setAccountError('')
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

  // The name is edited on one screen and the two server-side preferences on
  // another, but they are one record and one request either way.
  const nameDirty = displayName !== (me.display_name ?? '')
  const displayDirty = units !== me.units || timezone !== me.timezone

  const saveAccount = async (event: FormEvent) => {
    event.preventDefault()
    setSavingAccount(true)
    setAccountError('')
    try {
      onChange(
        await api<Me>('/account', {
          method: 'PATCH',
          body: { display_name: displayName, units, timezone },
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
      <Targets me={me} onBack={() => go(null)} onOpenProfile={() => go('profile')} />
    )
  }

  if (screen === 'queue') return <AdminQueue onBack={leaveAdmin} onDecided={onReviewed} />
  if (screen === 'invites') return <AdminInvites onBack={leaveAdmin} />
  if (screen === 'users') return <AdminUsers onBack={leaveAdmin} />

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
            <label className="flex-1 text-sm" htmlFor="settings-timezone">
              Time zone
            </label>
            <select
              id="settings-timezone"
              className="t-input max-w-[55%]"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            >
              {zones(me.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
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
        <Row label="Targets" icon={Target} onOpen={() => go('targets')} />
        <Row label="Display" icon={Monitor} onOpen={() => go('display')} />
        <Row label="My submissions" icon={Inbox} onOpen={onOpenSubmissions} />
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
            <Row label="Members" icon={Users} onOpen={() => go('users')} />
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
