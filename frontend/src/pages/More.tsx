import {
  BookOpen,
  ChevronRight,
  ClipboardList,
  Eye,
  HeartPulse,
  History,
  IdCard,
  Inbox,
  Info,
  Mail,
  MessageSquare,
  Monitor,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Target,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Me, type SyncKey, type Units } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Sheet } from '../components/Sheet'
import { type Glyph } from '../components/TabBar'
import { SaveMarks, useInstantSave, useSavedChip } from '../components/SaveMarks'
import { useTopBar, type TopBarHeader } from '../hooks/useTopBar'
import { useRailLayout } from '../hooks/useWideLayout'
import { type Clock } from '../lib/clock'
import { reviews } from '../lib/roles'
import { ZONES, offList } from '../lib/zones'
import { applyTheme, rememberTheme, useTheme, type Theme } from '../theme'
import { About } from './About'
import { AdminInvites } from './AdminInvites'
import { AdminQueue } from './AdminQueue'
import { AdminRoles } from './AdminRoles'
import { AdminUploads } from './AdminUploads'
import { AdminUsers } from './AdminUsers'
import { Feedback, FeedbackLog } from './Feedback'
import { Fitness } from './Fitness'
import { Guide } from './Guide'
import { Members } from './Members'
import { ReviewLog } from './ReviewLog'
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
  | 'reviewlog'
  | 'invites'
  | 'roles'
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

// What somebody is asked before they put their name forward, and what the row
// reads once they have.
const APPLY_TITLE = 'Review foods for Tare?'
const APPLY_BODY =
  'Reviewers check submitted foods against their labels, approve or fix them, and keep the Tare database honest. An administrator decides who reviews.'
const APPLY_SENT = 'Application sent'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// How many people are waiting on an answer, said under the row that opens them.
function requestsNote(count: number): string {
  return count === 1 ? '1 request' : `${count} requests`
}

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
  requests,
  refresh,
  onReviewed,
  onChanged,
  onOpenBiometrics,
  onOpenFood,
  start,
  onStarted,
  onScreen,
  targetsBack,
  fitnessDate,
}: {
  me: Me
  onChange: (me: Me) => void
  onSignedOut: () => void
  // How many submissions are waiting. Read once above this screen, because the
  // navigation says the same number.
  waiting: number
  // How many friend requests nobody has answered, said under the Members row.
  requests: number
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
  // Where Targets should go back to, when somebody was sent to it from
  // outside this tab. The list's own way back stands without it.
  targetsBack?: { label: string; onBack: () => void }
  // The day the Fitness screen should read, when somebody was sent to one.
  fitnessDate?: string
}) {
  const theme = useTheme()
  // At rail width the rail already lists Targets and Fitness, so this list
  // does not say them twice.
  const railed = useRailLayout()
  const [screen, setScreen] = useState<Screen>(start ?? null)
  // What the sync row says under itself. One request when this tab opens, and
  // nothing after that: it is a line on a row, not a live figure.
  const [sync, setSync] = useState<SyncKey | null>(null)
  // Whether the reviewer application sheet is open, and whether it has been
  // sent. The account's own answer opens it, and this keeps it there for the
  // rest of the session without a second read.
  const [applying, setApplying] = useState(false)
  // Whether the question about signing out is up.
  const [signingOut, setSigningOut] = useState(false)
  const [applied, setApplied] = useState(me.reviewer_requested)
  const [applyError, setApplyError] = useState('')
  // Which member's profile is open on the Members or Sharing screen, if any.
  const [member, setMember] = useState<number | null>(null)

  const [units, setUnits] = useState<Units>(me.units)
  const [clock, setClock] = useState<Clock>(me.clock)
  const [timezone, setTimezone] = useState(me.timezone)
  const displaySave = useInstantSave()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, markPasswordSaved] = useSavedChip()
  const [savingPassword, setSavingPassword] = useState(false)

  // Whether the Email card has its field open, and what is typed in it. The
  // address on the account is not touched until the link sent to the new one
  // is opened, so this is a request rather than an edit.
  const [changingEmail, setChangingEmail] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

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


  const go = (next: Screen) => {
    setMember(null)
    setScreen(next)
  }

  // A friendship started or ended: the feed lists differently and one fewer
  // request is waiting.
  const friendshipChanged = () => {
    onChanged()
    onReviewed()
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
      ? {
          title: 'More',
          left: 'title',
          subtitle: me.display_name || me.username,
          subtitleRole: me.role,
        }
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

  // The display name is edited on Profile, which is where somebody looks for
  // what other members see. This screen keeps the reading preferences, and
  // each one saves as it is picked. A failure puts the select back.
  const patchDisplay = (body: Record<string, unknown>, undo: () => void) =>
    displaySave.run(async () => {
      try {
        onChange(await api<Me>('/account', { method: 'PATCH', body }))
      } catch (failure) {
        undo()
        throw failure
      }
    })

  const sendEmailLink = async (event: FormEvent) => {
    event.preventDefault()
    setSavingEmail(true)
    setEmailError('')
    try {
      onChange(await api<Me>('/account/email', { method: 'POST', body: { email: newEmail } }))
      setChangingEmail(false)
      setNewEmail('')
    } catch (failure) {
      setEmailError(errorText(failure))
    }
    setSavingEmail(false)
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

  const apply = async () => {
    setApplyError('')
    try {
      await api('/account/apply-reviewer', { method: 'POST' })
      setApplied(true)
      setApplying(false)
    } catch (failure) {
      setApplyError(errorText(failure))
    }
  }

  const leaveAdmin = () => {
    go(null)
    onReviewed()
  }
  if (screen === 'profile') {
    return (
      <>
        <Profile me={me} onChange={onChange} />
      </>
    )
  }

  if (screen === 'targets') {
    return (
      <Targets
        me={me}
        back={targetsBack ?? back}
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
        date={fitnessDate}
        onBack={() => go(null)}
        onOpenSync={() => go('sync')}
      />
    )
  }

  if (screen === 'members') {
    return member === null ? (
      <Members
        me={me.id}
        onBack={() => go(null)}
        onOpen={setMember}
        onAnswered={friendshipChanged}
      />
    ) : (
      <MemberView
        userId={member}
        back="Members"
        onBack={() => setMember(null)}
        onChange={friendshipChanged}
      />
    )
  }

  if (screen === 'sharing') {
    return member === null ? (
      <Sharing
        me={me}
        onChange={onChange}
        onBack={() => go(null)}
        onOpenProfile={() => setMember(me.id)}
      />
    ) : (
      <MemberView
        userId={member}
        back="Sharing"
        onBack={() => setMember(null)}
        onChange={friendshipChanged}
      />
    )
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
    return (
      <AdminQueue me={me} refresh={refresh} onBack={leaveAdmin} onDecided={onReviewed} />
    )
  }
  if (screen === 'reviewlog') return <ReviewLog me={me} onBack={() => go(null)} />
  if (screen === 'invites') return <AdminInvites onBack={leaveAdmin} />
  if (screen === 'roles') return <AdminRoles onBack={leaveAdmin} />
  if (screen === 'users') return <AdminUsers onBack={leaveAdmin} />
  if (screen === 'uploads') return <AdminUploads onBack={() => go(null)} />

  if (screen === 'account') {
    return (
      <>
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Email</p>
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm">{me.email ?? 'Not set'}</p>
            {!me.email_verified && <span className="t-chip shrink-0">Unverified</span>}
          </div>
          {/* The new address is only a request until its link is opened, so the
              card says where the link went rather than showing it as the one
              on the account. */}
          {me.pending_email !== null && (
            <p className="mt-2 text-sm text-muted">Verification sent to {me.pending_email}.</p>
          )}
          <button
            type="button"
            className="mt-2 inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
            onClick={() => {
              setChangingEmail(!changingEmail)
              setEmailError('')
            }}
          >
            Change
          </button>
          {changingEmail && (
            <form className="mt-1 flex flex-col gap-3" onSubmit={sendEmailLink}>
              <div>
                <label className="t-label" htmlFor="settings-email">
                  New email
                </label>
                <input
                  id="settings-email"
                  className="t-input"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                />
              </div>
              {emailError && <p className="t-error">{emailError}</p>}
              <button
                className="t-btn t-btn-primary"
                type="submit"
                disabled={!newEmail || savingEmail}
              >
                Send the link
              </button>
            </form>
          )}
          <p className="mt-2 text-xs text-muted">
            Used to sign in and to reset your password. Never sold, never added to a list.
          </p>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-2">Username</p>
          <p className="text-base">{me.username}</p>
          <p className="mt-2 text-xs text-muted">Your permanent sign-in name.</p>
        </div>

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
        <div className="t-card mb-3">
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-units">
              Units
            </label>
            <select
              id="settings-units"
              className="t-input max-w-[55%]"
              value={units}
              onChange={(event) => {
                const next = event.target.value as Units
                const was = units
                setUnits(next)
                patchDisplay({ units: next }, () => setUnits(was))
              }}
            >
              {UNITS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {displaySave.saved && <span className="t-chip text-accent">Saved.</span>}
          </div>
          <div className="t-row">
            <label className="flex-1 text-sm" htmlFor="settings-clock">
              Time format
            </label>
            <select
              id="settings-clock"
              className="t-input max-w-[55%]"
              value={clock}
              onChange={(event) => {
                const next = event.target.value as Clock
                const was = clock
                setClock(next)
                patchDisplay({ clock: next }, () => setClock(was))
              }}
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
              onChange={(event) => {
                const next = event.target.value
                const was = timezone
                setTimezone(next)
                patchDisplay({ timezone: next }, () => setTimezone(was))
              }}
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
          {displaySave.error && <p className="t-error mt-2">{displaySave.error}</p>}
        </div>

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
        <Row
          label="Members"
          icon={Users}
          note={requests > 0 ? requestsNote(requests) : undefined}
          onOpen={() => go('members')}
        />
        <Row
          label="Sharing"
          icon={Eye}
          note="What your friends can see"
          onOpen={() => go('sharing')}
        />
        <Row label="Display" icon={Monitor} onOpen={() => go('display')} />
        <Row label="Send feedback" icon={MessageSquare} onOpen={() => go('feedback')} />
        <Row label="Guide" icon={BookOpen} onOpen={() => go('guide')} />
        <Row label="About" icon={Info} onOpen={() => go('about')} />
        <Row label="My submissions" icon={Inbox} onOpen={() => go('submissions')} />
        {/* Enough of this account's foods have been taken for them to put
            their name forward. Never automatic: an administrator decides. */}
        {me.reviewer_eligible &&
          (applied ? (
            <div className="t-row">
              <ShieldCheck className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
              <span className="min-w-0 flex-1 text-sm text-muted">{APPLY_SENT}</span>
            </div>
          ) : (
            <Row
              label="Apply to be a reviewer"
              icon={ShieldCheck}
              onOpen={() => setApplying(true)}
            />
          ))}
      </div>

      {reviews(me) && (
        <>
          <p className="t-micro mb-1">{me.is_admin ? 'Administration' : 'Reviewing'}</p>
          <div className="t-card mb-3">
            <Row
              label="Review queue"
              icon={ClipboardList}
              count={waiting}
              onOpen={() => go('queue')}
            />
            {/* The rest of it is the instance's own business, which a reviewer
                has nothing to do with. */}
            {me.is_admin && (
              <>
                <Row label="Review log" icon={History} onOpen={() => go('reviewlog')} />
                <Row label="Invites" icon={Mail} onOpen={() => go('invites')} />
                <Row label="Roles" icon={ShieldCheck} onOpen={() => go('roles')} />
                <Row label="Member accounts" icon={Users} onOpen={() => go('users')} />
                <Row label="Uploads" icon={Upload} onOpen={() => go('uploads')} />
                <Row label="Feedback log" icon={ScrollText} onOpen={() => go('feedbacklog')} />
              </>
            )}
          </div>
        </>
      )}

      <div className="t-card mb-3">
        <button className="t-btn w-full" type="button" onClick={() => setSigningOut(true)}>
          Sign out
        </button>
      </div>

      <Sheet open={applying} label={APPLY_TITLE} center onClose={() => setApplying(false)}>
        <p className="text-base font-semibold">{APPLY_TITLE}</p>
        <p className="mt-2 text-sm text-muted">{APPLY_BODY}</p>
        {applyError && <p className="t-error mt-3">{applyError}</p>}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            onClick={() => void apply()}
          >
            Apply
          </button>
          <button type="button" className="t-btn" onClick={() => setApplying(false)}>
            Not now
          </button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={signingOut}
        label="Sign out"
        question="Sign out of Tare?"
        verb="Sign out"
        danger={false}
        onConfirm={() => {
          setSigningOut(false)
          void signOut()
        }}
        onClose={() => setSigningOut(false)}
      />
    </>
  )
}
