import type { Micros } from '../lib/micros'
import { MICROS, microText, percentDv } from '../lib/micros'
import { Sheet } from './Sheet'

// How far the bar is allowed to draw. A day at twice the Daily Value still
// fills the bar once, and the figure beside it says the rest.
const FULL = 100

// The day's vitamins and minerals: every one of the twenty-seven in label
// order, so a nutrient nothing carried reads as an empty bar rather than as a
// row that is missing. The amounts are the day's own, worked out server-side
// from the portions that were logged.
export function VitaminsSheet({
  micros,
  day,
  onClose,
}: {
  micros: Micros
  // The day these are for, said the way every other sheet says it.
  day: string
  onClose: () => void
}) {
  return (
    <Sheet open label="Vitamins" tall onClose={onClose}>
      <p className="text-base font-semibold">Vitamins</p>
      <p className="mb-3 text-xs text-muted">{day}</p>

      {MICROS.map((micro) => {
        const amount = micros[micro.key] ?? 0
        const percent = percentDv(micro, amount)
        return (
          <div key={micro.key} className="py-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm">{micro.label}</span>
              <span className="t-nums text-xs">
                {microText(amount)}
                <span className="text-muted"> {micro.unit} · {percent}%</span>
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.min(percent, FULL)}%` }}
              />
            </div>
          </div>
        )
      })}

      <p className="mt-3 text-xs text-muted">Percent of the FDA Daily Value for adults.</p>
    </Sheet>
  )
}
