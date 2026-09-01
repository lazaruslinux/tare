import { useState, type FormEvent } from 'react'

import { api, errorText, type Me } from '../api'

// The only way in. No sign-up link and no forgotten-password link, because
// neither exists: an account is made from an invite somebody sends you, and a
// forgotten password is something the person running the instance resets.
export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSignedIn(await api<Me>('/auth/login', { method: 'POST', body: { username, password } }))
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  return (
    <div className="t-center">
      <div className="w-full max-w-sm">
        <p className="mb-5 text-center text-2xl font-semibold tracking-tight lowercase">tare</p>
        <form className="t-card flex flex-col gap-3" onSubmit={submit}>
          <div>
            <label className="t-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="t-input"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div>
            <label className="t-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="t-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error && <p className="t-error">{error}</p>}
          <button className="t-btn t-btn-primary mt-1" type="submit" disabled={busy}>
            Sign in
          </button>
        </form>
        <p className="mt-4 text-center text-sm text-muted">
          New here? Ask a member for an invite.
        </p>
      </div>
    </div>
  )
}
