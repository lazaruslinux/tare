import { useEffect, useState, type FormEvent } from 'react'

import { api, errorText, type Me } from '../api'

type Version = { version: string; mail: boolean }
type Answer = { detail: string }

// The only way in. There is no sign-up link, because an account is made from an
// invite somebody sends you. The reset link is offered only on an instance with
// a mail server, since there is nowhere to send one without it.
export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mail, setMail] = useState(false)
  const [forgot, setForgot] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [address, setAddress] = useState('')
  // The one sentence a reset request is answered with, whatever the server did
  // about it. Printed as it stands rather than reworded here.
  const [answered, setAnswered] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    api<Version>('/version')
      .then((instance) => alive && setMail(instance.mail))
      // An instance that will not say is one that cannot help, so the link
      // stays off rather than offering something that goes nowhere.
      .catch(() => alive && setMail(false))
    return () => {
      alive = false
    }
  }, [])

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

  const sendLink = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const answer = await api<Answer>('/auth/forgot', {
        method: 'POST',
        body: { email: address },
      })
      setAnswered(answer.detail)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const backToSignIn = () => {
    setForgot(false)
    setAnswered('')
    setAddress('')
    setError('')
  }

  if (forgot) {
    return (
      <div className="t-center">
        <div className="w-full max-w-sm">
          <p className="mb-5 text-center text-2xl font-semibold tracking-tight">Tare</p>
          {answered ? (
            <div className="t-card">
              <p className="text-sm text-muted">{answered}</p>
            </div>
          ) : (
            <form className="t-card flex flex-col gap-3" onSubmit={sendLink}>
              <p className="text-sm text-muted">
                Type the address on your account and Tare sends a link for setting a new password.
              </p>
              <div>
                <label className="t-label" htmlFor="forgot-email">
                  Email
                </label>
                <input
                  id="forgot-email"
                  className="t-input"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </div>
              {error && <p className="t-error">{error}</p>}
              <button className="t-btn t-btn-primary mt-1" type="submit" disabled={busy}>
                Send the link
              </button>
            </form>
          )}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
              onClick={backToSignIn}
            >
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="t-center">
      <div className="w-full max-w-sm">
        <p className="mb-5 text-center text-2xl font-semibold tracking-tight">Tare</p>
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
        <div className="mt-3 flex flex-col items-center">
          {mail && (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
              onClick={() => {
                setForgot(true)
                setError('')
              }}
            >
              Forgot your password?
            </button>
          )}
          <p className="text-center text-sm text-muted">New here? Ask a member for an invite.</p>
        </div>
      </div>
    </div>
  )
}
