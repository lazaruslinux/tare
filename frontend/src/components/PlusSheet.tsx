import { Sheet } from './Sheet'

// What the centre action offers, in the order it was laid out. Only one of them
// has a feature behind it so far; the rest wait rather than pretending.
const BEFORE = ['Scan food']
const AFTER = ['Weigh-in', 'Manual exercise']

function Later({ rows }: { rows: string[] }) {
  return (
    <>
      {rows.map((row) => (
        <button key={row} disabled className="t-row w-full text-left opacity-40">
          {row}
        </button>
      ))}
    </>
  )
}

export function PlusSheet({
  open,
  onClose,
  onAddFood,
}: {
  open: boolean
  onClose: () => void
  onAddFood: () => void
}) {
  return (
    <Sheet open={open} label="Add" onClose={onClose}>
      <p className="t-micro mb-1">Add</p>
      <Later rows={BEFORE} />
      <button type="button" className="t-row w-full text-left" onClick={onAddFood}>
        Add food
      </button>
      <Later rows={AFTER} />
    </Sheet>
  )
}
