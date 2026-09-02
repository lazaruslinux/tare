import { useCallback, useState } from 'react'

import { api, errorText, type Food, type Me, type Prefill, type Scanned } from '../api'
import { slotByTime, today, type Slot } from '../lib/day'
import { BarcodeScanner } from './BarcodeScanner'
import { PortionSheet } from './PortionSheet'
import { Sheet } from './Sheet'
import { SubmitFoodSheet } from './SubmitFoodSheet'

// What happens between pointing a camera at a packet and having eaten it.
//
// The scan itself is one step of four, and which of the other three follows is
// the server's answer rather than this component's guess. A food that is in the
// shared database, or already yours, goes straight to the portion sheet: there
// is nothing to review. Anything else goes to the form, filled in as far as the
// lookup got.

type Stage =
  | { at: 'camera' }
  | { at: 'looking' }
  | { at: 'log'; food: Food }
  | { at: 'submit'; barcode: string | null; prefill: Prefill | null }
  | { at: 'failed'; message: string }

export function ScanFlow({
  me,
  date,
  slot,
  onClose,
  onLogged,
}: {
  me: Me
  // Where what is scanned lands. Left out from the centre control and the Food
  // tab, which both mean now; given by the Journal, which means the day and the
  // meal somebody is looking at.
  date?: string
  slot?: Slot
  onClose: () => void
  onLogged: () => void
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
        onDone={onLogged}
      />
    )
  }

  return (
    <SubmitFoodSheet
      barcode={stage.barcode}
      prefill={stage.prefill}
      onClose={onClose}
      onLog={(food) => setStage({ at: 'log', food })}
      onConflict={() => void resolve(code)}
    />
  )
}
