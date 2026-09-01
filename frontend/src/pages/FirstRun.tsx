import { useState, type FormEvent } from 'react'

import { api, errorText, type Me, type Units } from '../api'

// The one thing worth asking before the app opens. Weight and a goal belong
// here too and are not built yet, so this is a flow with one step rather than a
// screen pretending to be one: another step is added beside this one.
const STEPS: { units: Units; title: string; note: string }[] = [
  { units: 'imperial', title: 'Pounds and ounces', note: 'lb, oz, fl oz' },
  { units: 'metric', title: 'Grams and millilitres', note: 'g, ml' },
]

export function FirstRun({ me, onDone }: { me: Me; onDone: (me: Me) => void }) {
  const [units, setUnits] = useState<Units>(me.units)
  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(
        await api<Me>('/account', {
          method: 'PATCH',
          body: { units, display_name: displayName },
        })
      )
    } catch (failure) {
      setError(errorText(failure))
      setBusy(false)
    }
  }

  return (
    <div className="t-center">
      <form className="w-full max-w-sm" onSubmit={submit}>
        <p className="mb-1 text-xl font-semibold tracking-tight">How do you measure?</p>
        <p className="mb-4 text-sm text-muted">You can change this later.</p>

        <div className="mb-4 flex gap-3">
          {STEPS.map((step) => (
            <button
              key={step.units}
              type="button"
              aria-pressed={units === step.units}
              className="t-choice"
              onClick={() => setUnits(step.units)}
            >
              <span className="block text-sm font-semibold">{step.title}</span>
              <span className="block text-xs">{step.note}</span>
            </button>
          ))}
        </div>

        <label className="t-label" htmlFor="first-display-name">
          What should we call you? (optional)
        </label>
        <input
          id="first-display-name"
          className="t-input"
          autoComplete="nickname"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />

        {error && <p className="t-error mt-3">{error}</p>}

        <button className="t-btn t-btn-primary mt-4 w-full" type="submit" disabled={busy}>
          Continue
        </button>
        <button
          className="mt-3 w-full text-sm text-muted"
          type="button"
          onClick={() => onDone(me)}
        >
          Skip
        </button>
      </form>
    </div>
  )
}
