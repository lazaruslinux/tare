import { Sheet } from './Sheet'

// The question every button that removes saved data asks first. One shape, so
// a removal on one screen reads the same as a removal on another, and nothing
// leaves without an answer.
export function ConfirmSheet({
  open,
  label,
  question,
  note,
  tone,
  verb,
  cancel = 'Cancel',
  danger = true,
  busy = false,
  error = null,
  onConfirm,
  onClose,
}: {
  open: boolean
  // What the sheet is called to a screen reader.
  label: string
  question: string
  note?: string
  // The question in the danger colour, for the deletions that read that way.
  tone?: 'danger'
  // What the confirming button says.
  verb: string
  cancel?: string
  danger?: boolean
  // The request is out; neither button takes a second answer.
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Sheet open={open} label={label} center onClose={onClose}>
      <p
        className={`text-base font-semibold${tone === 'danger' ? ' tracking-tight text-danger' : ''}`}
      >
        {question}
      </p>
      {note !== undefined && <p className="mt-2 text-sm text-muted">{note}</p>}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className={`t-btn ${danger ? 't-btn-danger' : 't-btn-primary'} flex-1`}
          disabled={busy}
          onClick={onConfirm}
        >
          {verb}
        </button>
        <button type="button" className="t-btn" disabled={busy} onClick={onClose}>
          {cancel}
        </button>
      </div>
      {error !== null && error !== '' && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Sheet>
  )
}
