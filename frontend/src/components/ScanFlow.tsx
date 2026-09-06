import { useCallback, useState } from 'react'

import { api, errorText, type Food, type Me, type Prefill, type Scanned } from '../api'
import { slotByTime, today, type Slot } from '../lib/day'
import { BarcodeScanner } from './BarcodeScanner'
import { FoodForm } from './FoodForm'
import { PortionSheet } from './PortionSheet'
import { Sheet } from './Sheet'

// What happens between pointing a camera at a package and having eaten it.
//
// The scan itself is one step of four, and which of the other three follows is
// the server's answer rather than this component's guess. A food that is in the
// Tare database, or already yours, goes straight to the portion sheet: there
// is nothing to review. Anything else goes to the form, filled in as far as the
// lookup got.

type Stage =
  | { at: 'camera' }
  | { at: 'looking' }
  | { at: 'log'; food: Food }
  | { at: 'submit'; barcode: string | null; prefill: Prefill | null }
  | { at: 'sent'; food: Food }
  | { at: 'failed'; message: string }

export function ScanFlow({
  me,
  date,
  slot,
  onClose,
  onLogged,
  onChanged,
  onPick,
}: {
  me: Me
  // Where what is scanned lands. Left out from the centre control and the Food
  // tab, which both mean now; given by the Journal, which means the day and the
  // meal somebody is looking at.
  date?: string
  slot?: Slot
  onClose: () => void
  onLogged?: () => void
  // A food was written, whether or not it is logged after. The tabs behind this
  // sheet list it, and Done closes the flow without logging anything.
  onChanged: () => void
  // Given instead when the scan is filling in a recipe or a kept meal. The
  // portion is handed back and nothing is written to the diary.
  onPick?: (food: Food, amount: number, unit: string) => void
}) {
  const [stage, setStage] = useState<Stage>({ at: 'camera' })
  const [code, setCode] = useState('')

  const resolve = useCallback(async (scanned: string) => {
    setCode(scanned)
    setStage({ at: 'looking' })
    try {
      const answer = await api<Scanned>(`/barcode/${scanned}`)
      if (answer.state === 'approved' || answer.state === 'mine') {
        setStage({ at: 'log', food: answer.food })
      } else if (answer.state === 'prefill') {
        setStage({ at: 'submit', barcode: answer.prefill.barcode, prefill: answer.prefill })
      } else {
        setStage({ at: 'submit', barcode: answer.barcode, prefill: null })
      }
    } catch (failure) {
      setStage({ at: 'failed', message: errorText(failure) })
    }
  }, [])

  if (stage.at === 'camera') {
    return <BarcodeScanner onCode={resolve} onClose={onClose} />
  }

  if (stage.at === 'looking') {
    return (
      <Sheet open label="Looking it up" onClose={onClose}>
        <p className="t-micro mb-1">Scanned</p>
        <p className="t-nums text-base font-semibold tracking-tight">{code}</p>
        <p className="mt-2 text-sm text-muted">Looking it up.</p>
      </Sheet>
    )
  }

  if (stage.at === 'failed') {
    return (
      <Sheet open label="Scan" onClose={onClose}>
        <p className="t-micro mb-1">Scanned</p>
        <p className="t-nums text-base font-semibold tracking-tight">{code}</p>
        <p className="t-error mt-2">{stage.message}</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            onClick={() => setStage({ at: 'camera' })}
          >
            Scan again
          </button>
          {/* Nothing came back, and the food may still be worth entering. */}
          <button
            type="button"
            className="t-btn"
            onClick={() => setStage({ at: 'submit', barcode: code, prefill: null })}
          >
            Enter it
          </button>
        </div>
      </Sheet>
    )
  }

  if (stage.at === 'log') {
    return (
      <PortionSheet
        food={stage.food}
        date={date ?? today(me.timezone)}
        slot={slot ?? slotByTime(me.timezone)}
        units={me.units}
        onClose={onClose}
        onDone={() => onLogged?.()}
        onPick={onPick}
      />
    )
  }

  // Sent, and still theirs to log. The food it became is what the portion
  // sheet opens on, so nothing has to be looked up again.
  if (stage.at === 'sent') {
    const sent = stage.food
    return (
      <Sheet open center label="Thanks for submitting" onClose={onClose}>
        <p className="text-base font-semibold tracking-tight">Thanks for submitting!</p>
        <p className="mt-1 text-sm">{sent.name}</p>
        <p className="mt-2 text-sm text-muted">
          This item is still yours to log and track. It will be available for everyone on
          Tare to track once it is approved.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            onClick={() => setStage({ at: 'log', food: sent })}
          >
            {onPick ? 'Add it now' : 'Log it now'}
          </button>
          <button type="button" className="t-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  // The form itself, inside the sheet the scan opened. The same form the Food
  // tab uses, with the code held still and the switch already on: somebody
  // holding a package nobody has entered is the case the database grows by.
  return (
    <Sheet open tall label="Add a food" onClose={onClose}>
      <FoodForm
        food={null}
        title="Add a food"
        backLabel="Scan"
        inSheet
        submitDefault
        prefill={stage.prefill}
        scannedBarcode={stage.barcode}
        onSaved={(food) => {
          setStage({ at: 'sent', food })
          onChanged()
        }}
        onCancel={onClose}
        onConflict={() => void resolve(code)}
      />
    </Sheet>
  )
}
