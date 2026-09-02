import { useState, type FormEvent } from 'react'

import { api, errorText, type Me } from '../api'

// The one screen an account made before tare asked for a birthdate sees, once.
// It is not a wall to argue with: the sentence says why, the server holds the
// rule, and the refusal it gives is what shows here.
export function Birthdate({ onDone }: { onDone: (me: Me) => void }) {
  const [birthdate, setBirthdate] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(await api<Me>('/account', { method: 'PATCH', body: { birthdate } }))
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  return (
    <div className="t-center">
      <form className="w-full max-w-sm" onSubmit={submit}>
        <p className="mb-1 text-xl font-semibold tracking-tight">When were you born?</p>
        <p className="mb-4 text-sm text-muted">tare is for adults 18 and over.</p>

        <label className="t-label" htmlFor="ask-birthdate">
          Date of birth
        </label>
        <input
          id="ask-birthdate"
          className="t-input"
          type="date"
          autoComplete="bday"
          value={birthdate}
          onChange={(event) => setBirthdate(event.target.value)}
        />
        <p className="mt-2 text-xs text-muted">
          It is used to work out your targets, and nobody else can see it.
        </p>

        {error && <p className="t-error mt-3">{error}</p>}

        <button
          className="t-btn t-btn-primary mt-4 w-full"
          type="submit"
          disabled={!birthdate || busy}
        >
          Continue
        </button>
      </form>
    </div>
  )
}
