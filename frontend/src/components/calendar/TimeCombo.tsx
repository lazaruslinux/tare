import { Clock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useClock } from '../../lib/clock'
import { formatTime } from '../../lib/calendar'

// A time somebody types, or picks off a list of half hours. Not a native time
// field: iOS ignores its step, so the picker becomes a minute-by-minute wheel
// for a value nobody ever needs to the minute. The value is always "HH:MM" on
// a twenty-four hour clock, whichever clock the account reads.

const HALF_HOURS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  return `${String(hour).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`
})

// What somebody typed, as a time. Takes 8, 830, 0830, 8:05 pm, 8am, 14:30,
// with or without a space before the half of the day. Null is text that is
// not a time at all.
export function parseTime(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  const read = text.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/)
  if (read === null) return null
  let hour = Number(read[1])
  const minute = read[2] === undefined ? 0 : Number(read[2])
  if (minute > 59) return null
  if (read[3] !== undefined) {
    if (hour < 1 || hour > 12) return null
    hour = (hour % 12) + (read[3] === 'pm' ? 12 : 0)
  } else if (hour > 23) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

// The half hour a time sits in, so the list can open where the value already
// is rather than at midnight.
function halfHour(value: string): string | null {
  const [hour, minute] = value.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  return `${String(hour).padStart(2, '0')}:${minute < 30 ? '00' : '30'}`
}

export function TimeCombo({
  id,
  label,
  value,
  anchor,
  onChange,
}: {
  id: string
  label: string
  // "HH:MM", or empty for none.
  value: string
  // Where the list opens when the field is empty: the Ends field takes the
  // Starts time, so a lunch at eleven opens its end list at eleven. It
  // positions the list and never picks anything.
  anchor?: string
  onChange: (next: string) => void
}) {
  const clock = useClock()
  const [text, setText] = useState(value === '' ? '' : formatTime(value, clock))
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // The last value handed upward, so a change the form made itself (all-day
  // clearing the times, an appointment loading for edit) redraws the text
  // while somebody's own half-typed entry is left alone.
  const said = useRef(value)

  useEffect(() => {
    if (value === said.current) return
    said.current = value
    setText(value === '' ? '' : formatTime(value, clock))
    setUnread(false)
  }, [value, clock])

  // Only on the way open: where the list starts is not something that should
  // chase the value while it is being picked.
  useEffect(() => {
    if (!open) return
    const key = halfHour(value || anchor || '')
    if (key === null) return
    const row = list.current?.querySelector<HTMLElement>(`[data-time="${key}"]`)
    if (row != null && list.current !== null) list.current.scrollTop = row.offsetTop
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const commit = (next: string) => {
    said.current = next
    onChange(next)
  }

  const readText = () => {
    const typed = text.trim()
    if (typed === '') {
      setUnread(false)
      commit('')
      return
    }
    const parsed = parseTime(typed)
    if (parsed === null) {
      // The text stays so it can be corrected, but the form holds no time:
      // what was typed is not one, and saving a time nobody asked for would
      // be worse than saying so.
      setUnread(true)
      commit('')
      return
    }
    setUnread(false)
    setText(formatTime(parsed, clock))
    commit(parsed)
  }

  const pick = (next: string) => {
    setUnread(false)
    setText(formatTime(next, clock))
    commit(next)
    setOpen(false)
  }

  return (
    <div ref={box} className="min-w-0">
      <label className="t-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          className="t-input pr-12"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder={clock === '24h' ? '08:00' : '8:00AM'}
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setUnread(false)
          }}
          onBlur={readText}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              readText()
              setOpen(false)
            }
            if (event.key === 'Escape' && open) setOpen(false)
          }}
        />
        <button
          type="button"
          aria-label={`Pick a time for ${label.toLowerCase()}`}
          aria-expanded={open}
          className="absolute top-1/2 right-1 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[0.5rem] bg-surface text-muted"
          onClick={() => setOpen(!open)}
        >
          <Clock className="h-4 w-4" strokeWidth={2} />
        </button>
        {open && (
          <ul
            ref={list}
            role="listbox"
            aria-label={label}
            className="t-card absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto p-1 shadow-lg"
          >
            {HALF_HOURS.map((half) => (
              <li key={half}>
                <button
                  type="button"
                  role="option"
                  data-time={half}
                  aria-selected={half === value}
                  className={`flex min-h-11 w-full items-center rounded-lg px-3 text-sm font-semibold ${
                    half === value ? 'bg-surface-2 text-accent' : 'text-text'
                  }`}
                  onClick={() => pick(half)}
                >
                  {formatTime(half, clock)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {unread && (
        <p className="mt-1 text-xs text-muted">
          Try a time like {clock === '24h' ? '08:00' : '8:00AM'}.
        </p>
      )}
    </div>
  )
}
