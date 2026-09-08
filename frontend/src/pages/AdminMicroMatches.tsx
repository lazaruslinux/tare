import { useEffect, useState } from 'react'

import { api, errorText, type MicroMatch } from '../api'
import { Lightbox } from '../components/Lightbox'
import { useTopBar } from '../hooks/useTopBar'

// Foods with no barcode, and the FoodData Central records that might be them.
// A barcode matches itself and needs nobody; a name is a guess, so the guesses
// are laid out here and an administrator says which is right. Applying fills
// only the vitamin rows the food has none of. Nothing here touches the panel.

const NOBODY_WAITING = 'Nothing is waiting on a match.'
const NONE_OF_THESE = 'None of these'

export function AdminMicroMatches({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<MicroMatch[] | null>(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  // Which card is mid-decision, so its buttons cannot be pressed twice.
  const [busy, setBusy] = useState<number | null>(null)
  const [looking, setLooking] = useState<string | null>(null)

  useTopBar({ title: 'Vitamin matches', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    api<MicroMatch[]>('/admin/micro-matches')
      .then((loaded) => alive && setRows(loaded))
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  // The decided card leaves the list rather than the list being read again:
  // the answer is known, and a second request would only redraw the rest.
  const settle = (id: number, said: string) => {
    setRows((held) => (held ?? []).filter((row) => row.id !== id))
    setNote(said)
  }

  const decide = async (row: MicroMatch, fdcId: number | null) => {
    setBusy(row.id)
    setError('')
    try {
      if (fdcId === null) {
        await api(`/admin/micro-matches/${row.id}/skip`, { method: 'POST' })
        settle(row.id, `${row.name} left alone.`)
      } else {
        const done = await api<{ filled: number }>(`/admin/micro-matches/${row.id}/apply`, {
          method: 'POST',
          body: { fdc_id: fdcId },
        })
        settle(row.id, `${row.name}: ${done.filled} filled in.`)
      }
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}
      {note && <p className="mb-3 text-sm text-muted">{note}</p>}

      {rows !== null && rows.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">{NOBODY_WAITING}</p>
        </div>
      )}

      {(rows ?? []).map((row) => (
        <div key={row.id} className="t-card mb-3">
          <p className="text-base font-semibold">{row.name}</p>
          {row.brand && <p className="text-sm text-muted">{row.brand}</p>}

          {row.label_photo_url !== null && (
            <button
              type="button"
              className="mt-3 block text-left"
              aria-label={`Look at the label for ${row.name}`}
              onClick={() => setLooking(row.label_photo_url)}
            >
              <img
                src={row.label_photo_url}
                alt={`The nutrition label for ${row.name}`}
                className="h-24 w-24 rounded-lg border border-line object-cover"
              />
            </button>
          )}

          <p className="t-micro mt-3 mb-1">Which record is it?</p>
          {row.candidates.map((candidate) => (
            <div key={candidate.fdc_id} className="t-row">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{candidate.description}</span>
                <span className="block text-xs text-muted">{candidate.data_type}</span>
              </span>
              <button
                type="button"
                className="t-btn shrink-0 min-h-9 px-3 py-1.5 text-sm"
                disabled={busy !== null}
                onClick={() => void decide(row, candidate.fdc_id)}
              >
                Use this
              </button>
            </div>
          ))}

          <div className="t-actions mt-3">
            <button
              type="button"
              className="t-btn w-full"
              disabled={busy !== null}
              onClick={() => void decide(row, null)}
            >
              {NONE_OF_THESE}
            </button>
          </div>
        </div>
      ))}

      {looking && <Lightbox src={looking} alt="The label" onClose={() => setLooking(null)} />}
    </>
  )
}
