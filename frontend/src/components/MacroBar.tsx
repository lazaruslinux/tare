// One of the three against its target, as a line and a share of it. The
// Dashboard and the Journal both read a day this way, so the bar is one thing.

export function MacroBar({
  label,
  value,
  target,
  unit,
}: {
  label: string
  // Null is a nutrient no entry carried at all, which is not none of it.
  value: number | null
  target: number
  unit: string
}) {
  const share = target <= 0 ? 0 : Math.min(Math.max((value ?? 0) / target, 0), 1)
  const percent = target <= 0 ? 0 : Math.round(((value ?? 0) / target) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className="t-nums text-xs">
          {value === null ? '-' : Math.round(value)}
          <span className="text-muted">
            {' '}
            / {target}
            {unit} · {percent}%
          </span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  )
}
