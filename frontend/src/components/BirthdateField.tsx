import { useEffect, useState } from 'react'

// Typed rather than picked: a phone's date wheel makes a birth year a long
// spin. Digits go in, the slashes come by themselves, and the field says an
// ISO day upward only once the whole date is there and real; until then it
// says an empty string, which every caller already treats as "not yet".
function fromIso(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return match ? `${match[2]}/${match[3]}/${match[1]}` : ''
}

function shaped(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

export function toIso(text: string): string {
  const digits = text.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  const iso = `${digits.slice(4)}-${digits.slice(0, 2)}-${digits.slice(2, 4)}`
  const probe = new Date(`${iso}T00:00:00Z`)
  // A day that does not exist (02/30) rolls over in Date and stops matching.
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== iso) return ''
  return iso
}

export function BirthdateField({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (iso: string) => void
}) {
  const [text, setText] = useState(fromIso(value))
  // A value that arrives after mount (Profile loads it) or is rolled back by
  // the caller replaces the text; a part-typed date reads as '' and is kept.
  useEffect(() => {
    setText((current) => (toIso(current) === value ? current : fromIso(value)))
  }, [value])
  return (
    <input
      id={id}
      className="t-input"
      type="text"
      inputMode="numeric"
      autoComplete="bday"
      placeholder="MM/DD/YYYY"
      maxLength={10}
      value={text}
      onChange={(event) => {
        const next = shaped(event.target.value)
        setText(next)
        onChange(toIso(next))
      }}
    />
  )
}
