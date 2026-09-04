import { useReducedMotion } from 'framer-motion'

// One thing that is on or off, as a row. A button rather than a checkbox: the
// whole row is the target, the label is part of it, and a button already
// answers to space and enter without anything here saying so.
export function Switch({
  label,
  note,
  checked,
  onChange,
}: {
  label: string
  // What this answer means, in the words of the thing it decides. Only the
  // switches that need saying carry one.
  note?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  const reduced = useReducedMotion()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="t-row w-full text-left"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm">{label}</span>
        {note !== undefined && <span className="block text-xs text-muted">{note}</span>}
      </span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full border ${
          checked ? 'border-accent bg-accent' : 'border-line bg-surface-2'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4.5 w-4.5 rounded-full ${
            checked ? 'left-[1.375rem] bg-bg' : 'left-0.5 bg-muted'
          }`}
          style={reduced ? undefined : { transition: 'left 0.18s ease, background-color 0.18s ease' }}
        />
      </span>
    </button>
  )
}
