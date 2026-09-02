import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText } from '../api'

type Invite = { inviter_display_name: string }
type Registration = { state: 'ready' | 'check_email' }

// A guide rather than a rule. The backend has one requirement, a length, and
// saying anything stricter here would be inventing a rule it does not enforce.
function strength(password: string): string {
  if (!password) return 'At least 10 characters. A few words you will remember beats a short one you will not.'
  if (password.length < 10) return `${10 - password.length} more to go.`
  return 'Long enough.'
}

export function Welcome({ code, onReady }: { code: string; onReady: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null)
  const [dead, setDead] = useState('')
  const [sent, setSent] = useState(false)

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
        <p className="mb-1 text-center text-2xl font-semibold tracking-tight lowercase">tare</p>
        <p className="mb-5 text-center text-sm text-muted">
          {invite.inviter_display_name} invited you to tare.
        </p>
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
            <p className="mt-1 text-xs text-muted">tare is for adults 18 and over.</p>
          </div>
          <div>
            <label className="t-label" htmlFor="new-email">
              Email (optional)
            </label>
            <input
              id="new-email"
              className="t-input"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
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
      </div>
    </div>
  )
}
