import { Sheet } from './Sheet'

// What the centre action offers, in the order it was laid out. The two at the
// bottom have no feature behind them yet; they wait rather than pretending.
const LATER = ['Weigh-in', 'Manual exercise']

export function PlusSheet({
  open,
  onClose,
  onScan,
  onAddFood,
}: {
  open: boolean
  onClose: () => void
  onScan: () => void
  onAddFood: () => void
}) {
  return (
    <Sheet open={open} label="Add" onClose={onClose}>
      <p className="t-micro mb-1">Add</p>
      <button type="button" className="t-row w-full text-left" onClick={onScan}>
        Scan food
      </button>
      <button type="button" className="t-row w-full text-left" onClick={onAddFood}>
        Add food
      </button>
      {LATER.map((row) => (
        <button key={row} disabled className="t-row w-full text-left opacity-40">
          {row}
        </button>
      ))}
    </Sheet>
  )
}
