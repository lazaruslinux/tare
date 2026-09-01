import { useEffect, useState } from 'react'

import { api, errorText } from '../api'

// Spends the link from the verification mail and says how it went. Nothing to
// fill in: the token was in the address, and by the time this renders it has
// already been taken out of it.
export function VerifyEmail({ token, onSignIn }: { token: string; onSignIn: () => void }) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => alive && setMessage('Your email is verified. You can sign in now.'))
      .catch((failure) => alive && setMessage(errorText(failure)))
    return () => {
      alive = false
    }
  }, [token])

  if (!message) return null

  return (
    <div className="t-center">
      <div className="w-full max-w-sm text-center">
        <p className="mb-4 text-muted">{message}</p>
        <button className="t-btn t-btn-primary" type="button" onClick={onSignIn}>
          Sign in
        </button>
      </div>
    </div>
  )
}
