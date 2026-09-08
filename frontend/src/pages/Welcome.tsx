import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText } from '../api'
import { strength } from '../lib/password'
import { TareStory } from '../components/TareStory'
import { TareWordmark } from '../components/TareWordmark'

type Invite = { inviter_display_name: string }
type Registration = { state: 'ready' | 'check_email' }

// The one line for somebody who already has an account and opened an invite
// anyway. The address is already / by the time this renders, so the link is a
// plain navigation to the sign-in screen, or into the app if a session stands.
function SignIn({ className }: { className?: string }) {
  return (
    <p className={`text-center text-sm text-muted ${className ?? ''}`}>
      Already have a Tare account?{' '}
      <a className="inline-flex min-h-11 items-center text-accent underline underline-offset-4" href="/">
        Sign in
      </a>
    </p>
  )
}

export function Welcome({ code, onReady }: { code: string; onReady: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [dead, setDead] = useState('')
  // The story, opened in place on a phone. Nothing about the address changes,
  // so the invite code is not spent by a look at what it is an invite to. From
  // 900px it stands beside the form and this is never used.
  const [about, setAbout] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<Invite>(`/invites/${encodeURIComponent(code)}`)
      .then((found) => alive && setInvite(found))
      .catch((failure) => alive && setDead(errorText(failure)))
    return () => {
      alive = false
    }
  }, [code])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      // Both endings sign the browser in, so the answer is not read here:
      // which screen that lands on is the app's call, either the first-run
      // questions or the wall until the mailed link is opened.
      await api<Registration>('/auth/register', {
        method: 'POST',
        body: {
          invite_code: code,
          username,
          password,
          birthdate,
          email,
          display_name: displayName,
          // Taken from the browser rather than asked for. Nobody opening an
          // invite wants to pick their own zone off a list of six hundred, and
          // the one place it matters is which day a meal lands on.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      })
      onReady()
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  if (dead) {
    return (
      <div className="t-center">
        <p className="max-w-sm text-center text-muted">{dead}</p>
      </div>
    )
  }

  // Nothing at all until the invite has answered: a form that appears and then
  // disappears is worse than a moment of quiet.
  if (!invite) return null

  return (
    <div className="t-invite">
      <div className="w-full max-w-sm min-[900px]:max-w-none">
        <p className="mb-2 flex justify-center">
          <TareWordmark size={32} />
        </p>
        <p className="mx-auto mb-4 max-w-xl text-center text-sm text-muted">
          {invite.inviter_display_name} has invited you to Tare: A free, community-managed
          grocery database, nutrition &amp; fitness journal, custom weight goal builder and
          more.
        </p>
        {/* One column on a phone, where the story takes the form's place; two
            from 900px, where there is room for both and the form follows the
            story down the page. */}
        <div className="min-[900px]:grid min-[900px]:grid-cols-[minmax(0,44rem)_24rem] min-[900px]:items-start min-[900px]:gap-8">
          <div className={about ? '' : 'hidden min-[900px]:block'}>
            {/* No way back from a story that never took the form's place:
                from 900px both stand side by side. */}
            <TareStory
              invite
              onBack={about ? () => setAbout(false) : undefined}
              onCreate={() => document.getElementById('new-username')?.focus()}
            />
            <SignIn className="mt-4 min-[900px]:hidden" />
          </div>
          <div
            className={`min-[900px]:sticky min-[900px]:top-6 min-[900px]:block min-[900px]:self-start ${
              about ? 'hidden' : ''
            }`}
          >
            <div className="mb-2 flex justify-center min-[900px]:hidden">
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
                onClick={() => setAbout(true)}
              >
                Show me more
              </button>
            </div>
            <form className="t-card flex flex-col gap-3" onSubmit={submit}>
              <div>
                <label className="t-label" htmlFor="new-username">
                  Username
                </label>
                <input
                  id="new-username"
                  className="t-input"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div>
                <label className="t-label" htmlFor="new-password">
                  Password
                </label>
                <input
                  id="new-password"
                  className="t-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted">{strength(password)}</p>
              </div>
              <div>
                <label className="t-label" htmlFor="new-birthdate">
                  Date of birth
                </label>
                <input
                  id="new-birthdate"
                  className="t-input"
                  type="date"
                  autoComplete="bday"
                  value={birthdate}
                  onChange={(event) => setBirthdate(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted">
                  Tare is for users aged 18+. Kids accounts are in plans to be developed.
                </p>
              </div>
              <div>
                <label className="t-label" htmlFor="new-email">
                  Email
                </label>
                <input
                  id="new-email"
                  required
                  className="t-input"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <p className="mt-1 text-xs text-muted">
                  Required for user verification; never sold or added to any lists
                </p>
              </div>
              <div>
                <label className="t-label" htmlFor="new-display-name">
                  Display name (optional)
                </label>
                <input
                  id="new-display-name"
                  className="t-input"
                  autoComplete="nickname"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              {error && <p className="t-error">{error}</p>}
              <button className="t-btn t-btn-primary mt-1" type="submit" disabled={busy}>
                Create account
              </button>
            </form>
            <SignIn className="mt-4" />
          </div>
        </div>
      </div>
    </div>
  )
}
