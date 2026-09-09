import { useEffect, useState } from 'react'

import { api, errorText } from '../api'
import { Footer } from '../components/Footer'

// Spends the link from the verification mail and says how it went. Nothing to
// fill in: the token was in the address, and by the time this renders it has
// already been taken out of it.
export function VerifyEmail({
  token,
  version,
  onContinue,
}: {
  token: string
  version: string
  onContinue: () => void
}) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(() => alive && setMessage('Your email is verified.'))
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
        {/* One button for both endings. Whoever opened the link in the browser
            they signed up in lands in the app; anybody else lands on sign in. */}
        <button className="t-btn t-btn-primary" type="button" onClick={onContinue}>
          Continue
        </button>
        <Footer version={version} />
      </div>
    </div>
  )
}
