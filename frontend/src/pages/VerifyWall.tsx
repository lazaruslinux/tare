import { useState, type FormEvent } from 'react'

import { api, errorText, type Me } from '../api'
import { TareWordmark } from '../components/TareWordmark'

// The one screen an account that has not answered its verification mail can
// reach. Everything else on this instance answers 403 until the link is
// opened, so this screen holds every way out of that: another link, a
// different address, a second look, and the door.
export function VerifyWall({
  me,
  onVerified,
  onSignOut,
}: {
  me: Me
  // Reads the account again. True means it is verified now, and the app has
  // already moved on by the time this answers.
  onVerified: () => Promise<boolean>
  onSignOut: () => void
}) {
  // The account as this screen last saw it. Sending to a new address answers
  // with the whole account, so the address on screen is never a save behind.
  const [who, setWho] = useState(me)
  const [changing, setChanging] = useState(false)
  const [address, setAddress] = useState('')
  // The last thing that happened, said in one line under the buttons.
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Where the link went: the address a change is waiting on, or the account's
  // own. Null on an account carrying no address at all.
  const sentTo = who.pending_email ?? who.email

  const resend = async () => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      await api('/auth/resend-verification', { method: 'POST' })
      setNote('Sent.')
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNote('')
    try {
      const answer = await api<Me>('/account/email', { method: 'POST', body: { email: address } })
      setWho(answer)
      setChanging(false)
      setAddress('')
      setNote(`The link went to ${answer.pending_email ?? answer.email}.`)
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const signOut = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // The cookie is the session and the browser has let go of it either way.
    }
    onSignOut()
  }

  const recheck = async () => {
    setBusy(true)
    setError('')
    setNote('')
    try {
      if (!(await onVerified())) setNote('Not yet. Open the link in the email first.')
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const field = (
    <form className="flex flex-col gap-3" onSubmit={send}>
      <div>
        <label className="t-label" htmlFor="wall-email">
          Email
        </label>
        <input
          id="wall-email"
          className="t-input"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </div>
      <button className="t-btn t-btn-primary" type="submit" disabled={busy || !address}>
        Send the link
      </button>
    </form>
  )

  return (
    <div className="t-center">
      <div className="w-full max-w-sm">
        <p className="mb-5 flex justify-center">
          <TareWordmark size={32} />
        </p>
        <div className="t-card flex flex-col gap-3">
          <p className="t-micro">{sentTo === null ? 'Add your email' : 'Verify your email'}</p>
          <p className="text-sm text-muted">
            {sentTo === null
              ? 'Tare sends a link to this address to finish signing in.'
              : `We sent a link to ${sentTo}. Open it to finish signing in.`}
          </p>

          {sentTo !== null && (
            <>
              <button
                className="t-btn t-btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void recheck()}
              >
                I've verified it
              </button>
              {/* Only while the account's own address is the one waiting on an
                  answer. A resend goes to that address and replaces whatever
                  link is outstanding, so offering it during a change would
                  quietly kill the link sent to the new one. */}
              {who.pending_email === null && (
                <button
                  className="t-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void resend()}
                >
                  Send the link again
                </button>
              )}
              {/* A toggle rather than a door: the two buttons above stay where
                  they are, so opening the field is never a way to lose them. */}
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center text-sm text-accent underline underline-offset-4"
                onClick={() => {
                  setChanging(!changing)
                  setNote('')
                  setError('')
                }}
              >
                Use a different address
              </button>
            </>
          )}
          {(sentTo === null || changing) && field}

          {error && <p className="t-error">{error}</p>}
          {note && <p className="text-sm text-muted">{note}</p>}
        </div>
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
