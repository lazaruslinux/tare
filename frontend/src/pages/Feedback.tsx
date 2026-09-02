import { useEffect, useRef, useState } from 'react'

import { api, errorText } from '../api'

// Where it happened and what kind of thing it is, in the words the screens
// use. The keys are the server's.
const AREAS: { value: string; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'journal', label: 'Journal' },
  { value: 'food', label: 'Food' },
  { value: 'scanner', label: 'Scanner' },
  { value: 'targets', label: 'Targets' },
  { value: 'measurements', label: 'Measurements' },
  { value: 'more', label: 'More' },
  { value: 'other', label: 'Other' },
]

const KINDS: { value: string; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'wording', label: 'Wording' },
  { value: 'confusing', label: 'Confusing' },
]

function Chips({
  label,
  options,
  chosen,
  onPick,
}: {
  label: string
  options: { value: string; label: string }[]
  chosen: string
  onPick: (value: string) => void
}) {
  return (
    <>
      <p className="t-micro mb-2">{label}</p>
      <div className="mb-4 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen === option.value}
            className="t-chip t-tap44 aria-pressed:border-accent aria-pressed:text-text"
            onClick={() => onPick(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </>
  )
}

export function Feedback({ onSent }: { onSent: () => void }) {
  const [area, setArea] = useState('')
  const [kind, setKind] = useState('')
  const [text, setText] = useState('')
  const [expected, setExpected] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const ready = area !== '' && kind !== '' && text.trim() !== ''

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await api('/feedback', { method: 'POST', body: { area, kind, text, expected } })
      setArea('')
      setKind('')
      setText('')
      setExpected('')
      onSent()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  return (
    <div className="t-card mb-3">
      <Chips label="Where" options={AREAS} chosen={area} onPick={setArea} />
      <Chips label="What kind" options={KINDS} chosen={kind} onPick={setKind} />

      <label className="t-micro mb-2 block" htmlFor="feedback-text">
        What happened
      </label>
      <textarea
        id="feedback-text"
        className="t-input mb-4"
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <label className="t-micro mb-2 block" htmlFor="feedback-expected">
        What you expected (optional)
      </label>
      <input
        id="feedback-expected"
        className="t-input"
        value={expected}
        onChange={(event) => setExpected(event.target.value)}
      />

      {error && <p className="t-error mt-3">{error}</p>}

      <button
        type="button"
        className="t-btn t-btn-primary mt-3"
        disabled={!ready || sending}
        onClick={() => void send()}
      >
        Send
      </button>
    </div>
  )
}

// The whole file as it stands, for the one account that can read it. Opened at
// the bottom, because the newest report is the last line of it.
export function FeedbackLog() {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let alive = true
    api<{ text: string }>('/feedback')
      .then((loaded) => alive && setText(loaded.text))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (box.current !== null) box.current.scrollTop = box.current.scrollHeight
  }, [text])

  if (error) return <p className="t-error mb-3">{error}</p>
  if (text === null) return null
  if (text.trim() === '') return <p className="text-sm text-muted">Nothing sent yet.</p>

  return (
    <pre
      ref={box}
      className="t-card mb-3 max-h-[70svh] overflow-auto text-[0.8125rem] whitespace-pre-wrap"
    >
      {text}
    </pre>
  )
}
