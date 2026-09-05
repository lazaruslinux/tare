import { useState, type FormEvent } from 'react'

import { api, errorText, type Me } from '../api'
import { strength } from '../lib/password'
import { TareWordmark } from '../components/TareWordmark'

// Spends the link from the reset mail. Asked twice, because there is no old
// password to fall back on if the new one was mistyped: the answer to this
// form is a session, and the next sign-in is the only place a typo would show.
export function ResetPassword({
  token,
  onSignedIn,
}: {
  token: string
  onSignedIn: (me: Me) => void
}) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== again) {
      setError('Those two do not match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      onSignedIn(await api<Me>('/auth/reset', { method: 'POST', body: { token, password } }))
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  return (
    <div className="t-center">
      <div className="w-full max-w-sm">
        <p className="mb-2 flex justify-center">
          <TareWordmark size={32} />
        </p>
        <p className="mb-5 text-center text-sm text-muted">Choose a new password.</p>
        <form className="t-card flex flex-col gap-3" onSubmit={submit}>
          <div>
            <label className="t-label" htmlFor="reset-password">
              New password
            </label>
            <input
              id="reset-password"
              className="t-input"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <p className="mt-1 text-xs text-muted">{strength(password)}</p>
          </div>
          <div>
            <label className="t-label" htmlFor="reset-password-again">
              New password again
            </label>
            <input
              id="reset-password-again"
              className="t-input"
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(event) => setAgain(event.target.value)}
            />
          </div>
          {error && <p className="t-error">{error}</p>}
          <button className="t-btn t-btn-primary mt-1" type="submit" disabled={busy}>
            Set the password
          </button>
          <p className="text-xs text-muted">
            This signs you in here and signs out every other device.
          </p>
        </form>
      </div>
    </div>
  )
}
