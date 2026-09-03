import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText } from '../api'
import { AboutTare } from '../components/AboutTare'
import { strength } from '../lib/password'

type Invite = { inviter_display_name: string }
type Registration = { state: 'ready' | 'check_email' }

// Whether this instance sends mail, which is what decides if the address is
// optional: with a mail server the server refuses to sign anybody up without one.
type Version = { version: string; mail: boolean }

export function Welcome({ code, onReady }: { code: string; onReady: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [dead, setDead] = useState('')
  const [sent, setSent] = useState(false)
  // The summary, opened in place. Nothing about the address changes, so the
  // invite code is not spent by a look at what it is an invite to.
  const [about, setAbout] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [email, setEmail] = useState('')
  const [mail, setMail] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<Version>('/version')
      .then((instance) => alive && setMail(instance.mail))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

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
      const answer = await api<Registration>('/auth/register', {
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
      if (answer.state === 'ready') onReady()
      else setSent(true)
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

  if (sent) {
    return (
      <div className="t-center">
        <p className="max-w-sm text-center text-muted">
          Check your email for a link to finish signing up.
        </p>
      </div>
    )
  }

  return (
    <div className="t-center">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-center text-2xl font-semibold tracking-tight">Tare</p>
        <p className="text-center text-sm text-muted">
          {invite.inviter_display_name} has invited you to Tare.
        </p>
        {about ? (
          <div className="mt-4">
            <AboutTare onBack={() => setAbout(false)} />
          </div>
        ) : (
          <>
          <div className="mb-2 flex justify-center">
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
              onClick={() => setAbout(true)}
            >
              What is Tare?
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
              <p className="mt-1 text-xs text-muted">Tare is for adults 18 and over.</p>
            </div>
            <div>
              <label className="t-label" htmlFor="new-email">
                {mail ? 'Email' : 'Email (optional)'}
              </label>
              <input
                id="new-email"
                required={mail}
                className="t-input"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p className="mt-1 text-xs text-muted">
                Used to sign in and to reset your password. Never sold, never added to a list.
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
          </>
        )}
      </div>
    </div>
  )
}
