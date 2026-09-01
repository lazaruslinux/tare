import { ImagePlus, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'

import { ApiError, api, errorText, upload, type Food, type Prefill } from '../api'
import {
  MACRO_WARNING,
  MAX_PHOTO_BYTES,
  PHOTO_TOO_LARGE,
  SHARED_FACTS,
  macroDoubt,
  missingSentence,
  type Values,
} from '../lib/community'
import type { BaseUnit } from '../lib/units'
import type { Nutrient } from './NutritionLabel'
import { Sheet } from './Sheet'

// The form that offers a food to everybody. Its whole shape follows from one
// rule: what goes in here is what the next hundred people will eat out of, and
// the only person who will ever be holding the packet is the one filling it in.
// So the panel is not folded, every box is asked for, and the sheet says out
// loud what happens next.

const BASES: { value: BaseUnit; title: string }[] = [
  { value: 'g', title: 'Grams' },
  { value: 'ml', title: 'Millilitres' },
]

type ServingDraft = { name: string; amount: string }

// A typed box as a number, or nothing. An empty box is not zero, which is the
// difference the completeness rule is entirely about.
function num(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function startingPanel(prefill: Prefill | null): Record<Nutrient, string> {
  const panel = {} as Record<Nutrient, string>
  for (const fact of SHARED_FACTS) {
    const value = prefill ? prefill[fact.key] : null
    panel[fact.key] = value === null ? '' : String(value)
  }
  return panel
}

function startingServings(prefill: Prefill | null): ServingDraft[] {
  if (!prefill?.serving) return [{ name: '', amount: '' }]
  return [{ name: prefill.serving.name, amount: String(prefill.serving.base_amount) }]
}

export function SubmitFoodSheet({
  barcode,
  prefill,
  onClose,
  onLog,
  onConflict,
}: {
  barcode: string | null
  prefill: Prefill | null
  onClose: () => void
  onLog: (food: Food) => void
  // The barcode was claimed by the shared database while this was open. The
  // scan is worth resolving again rather than arguing with.
  onConflict?: () => void
}) {
  const [name, setName] = useState(prefill?.name ?? '')
  const [brand, setBrand] = useState(prefill?.brand ?? '')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(prefill?.base_unit ?? 'g')
  const [panel, setPanel] = useState(() => startingPanel(prefill))
  const [servings, setServings] = useState<ServingDraft[]>(() => startingServings(prefill))
  const [note, setNote] = useState('')
  const [photoId, setPhotoId] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [conflicted, setConflicted] = useState(false)
  const [sent, setSent] = useState<Food | null>(null)
  const boxes = useRef<Record<string, HTMLInputElement | null>>({})

  const values = (): Values => {
    const read = {} as Values
    for (const fact of SHARED_FACTS) read[fact.key] = num(panel[fact.key])
    return read
  }

  const setFact = (key: Nutrient, value: string) => {
    setPanel({ ...panel, [key]: value })
    // Cleared as soon as somebody starts correcting: a warning that stays up
    // while the number under it changes stops meaning anything.
    setWarning('')
  }

  const setServing = (index: number, draft: ServingDraft) =>
    setServings(servings.map((row, at) => (at === index ? draft : row)))

  const attach = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_PHOTO_BYTES) {
      setError(PHOTO_TOO_LARGE)
      return
    }
    setUploading(true)
    try {
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file)
      setPhotoId(photo_id)
    } catch (failure) {
      setError(errorText(failure))
    }
    setUploading(false)
  }

  const focusFirst = (key: Nutrient) => {
    const box = boxes.current[key]
    box?.scrollIntoView({ block: 'center' })
    box?.focus()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const read = values()
    const rows = servings.filter((row) => row.name.trim() || row.amount.trim())

    const missing = missingSentence(read, rows.length)
    if (missing !== null) {
      setError(missing)
      const doubted = macroDoubt(read)
      if (doubted !== null) focusFirst(doubted)
      return
    }
    const doubted = macroDoubt(read)
    if (doubted !== null && !warning) {
      // Said once, and only once. It is a question about what the label says,
      // not a refusal, so a second press sends it.
      setWarning(MACRO_WARNING)
      focusFirst(doubted)
      return
    }

    setSaving(true)
    setError('')
    setConflicted(false)
    try {
      const answer = await api<{ food: Food }>('/submissions/food', {
        method: 'POST',
        body: {
          barcode,
          name,
          brand,
          base_unit: baseUnit,
          ingredients_text: prefill?.ingredients_text ?? '',
          density_g_per_ml: prefill?.density_g_per_ml ?? null,
          photo_id: photoId,
          note,
          servings: rows.map((row, position) => ({
            name: row.name,
            base_amount: num(row.amount) ?? 0,
            position,
          })),
          ...read,
        },
      })
      setSent(answer.food)
    } catch (failure) {
      setError(errorText(failure))
      // The barcode was claimed while this was open. Read off the status
      // rather than the sentence: the wording is the server's to change.
      setConflicted(failure instanceof ApiError && failure.status === 409)
      setSaving(false)
    }
  }

  if (sent !== null) {
    return (
      <Sheet open label="Sent for approval" onClose={onClose}>
        <p className="t-micro mb-1">Sent</p>
        <p className="text-base font-semibold tracking-tight">{sent.name}</p>
        <p className="mt-2 text-sm text-muted">
          It is yours to log now. It reaches everyone once an administrator approves it.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            onClick={() => onLog(sent)}
          >
            Log it now
          </button>
          <button type="button" className="t-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open tall label="Add to the shared database" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="t-micro mb-2">Add to the shared database</p>

        {barcode && (
          <div className="t-card mb-3 flex items-center justify-between">
            <span className="text-sm text-muted">Barcode</span>
            <span className="t-nums text-sm">{barcode}</span>
          </div>
        )}

        <div className="t-card mb-3">
          <div className="mb-3">
            <label className="t-label" htmlFor="submit-name">
              Name
            </label>
            <input
              id="submit-name"
              className="t-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label className="t-label" htmlFor="submit-brand">
              Brand (optional)
            </label>
            <input
              id="submit-brand"
              className="t-input"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
            />
          </div>
          {prefill && (
            <p className="mt-3 text-xs text-muted">
              Filled in from {prefill.source}. Check every number against the packet.
            </p>
          )}
        </div>

        <div className="mb-3">
          <p className="t-micro mb-2">Measured in</p>
          <div className="flex gap-3">
            {BASES.map((base) => (
              <button
                key={base.value}
                type="button"
                aria-pressed={baseUnit === base.value}
                className="t-choice text-sm font-semibold"
                onClick={() => setBaseUnit(base.value)}
              >
                {base.title}
              </button>
            ))}
          </div>
        </div>

        <div className={`t-card mb-3 ${warning ? 'border-danger' : ''}`}>
          <p className="t-micro mb-1">Per 100 {baseUnit}</p>
          {SHARED_FACTS.map((fact) => (
            <div key={fact.key} className="t-row">
              <label className="flex-1 text-sm" htmlFor={`submit-${fact.key}`}>
                {fact.label}
                {fact.unit && <span className="text-muted"> ({fact.unit})</span>}
              </label>
              <input
                id={`submit-${fact.key}`}
                ref={(box) => {
                  boxes.current[fact.key] = box
                }}
                className="t-input t-nums max-w-[40%] text-right"
                inputMode="decimal"
                value={panel[fact.key]}
                onChange={(event) => setFact(fact.key, event.target.value)}
              />
            </div>
          ))}
          {warning ? (
            <p className="t-error mt-3">{warning}</p>
          ) : (
            <p className="mt-3 text-xs text-muted">
              All ten are needed. A food with none of something is a nought, not an empty box.
            </p>
          )}
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-1">Servings</p>
          {servings.map((serving, index) => (
            <div key={index} className="t-row">
              <input
                className="t-input min-w-0 flex-1"
                placeholder="1 bar"
                aria-label={`Serving ${index + 1} name`}
                value={serving.name}
                onChange={(event) => setServing(index, { ...serving, name: event.target.value })}
              />
              <input
                className="t-input t-nums w-20 text-right"
                inputMode="decimal"
                placeholder="43"
                aria-label={`Serving ${index + 1} amount`}
                value={serving.amount}
                onChange={(event) => setServing(index, { ...serving, amount: event.target.value })}
              />
              <span className="w-6 text-xs text-muted">{baseUnit}</span>
              {servings.length > 1 && (
                <button
                  type="button"
                  className="t-tap44 text-muted"
                  aria-label={`Remove serving ${index + 1}`}
                  onClick={() => setServings(servings.filter((_, at) => at !== index))}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          ))}
          <p className="mt-2 text-xs text-muted">
            What the label calls one serving, and how much of it that is in {baseUnit}.
          </p>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-2">Photo of the label</p>
          {photoId === null ? (
            <>
              <label className="t-btn w-full" htmlFor="submit-photo">
                <ImagePlus className="h-4 w-4" strokeWidth={2} />
                {uploading ? 'Adding' : 'Add a photo'}
              </label>
              <input
                id="submit-photo"
                className="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={attach}
              />
              <p className="mt-2 text-xs text-muted">
                Optional. It lets whoever reviews this check the numbers themselves.
              </p>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <img
                src={`/api/photos/${photoId}.webp`}
                alt="The label you attached"
                className="h-16 w-16 rounded-lg border border-line object-cover"
              />
              <button
                type="button"
                className="t-btn"
                onClick={() => setPhotoId(null)}
              >
                Remove
              </button>
            </div>
          )}
        </div>

        <div className="t-card mb-3">
          <label className="t-label" htmlFor="submit-note">
            Anything the reviewer should know (optional)
          </label>
          <input
            id="submit-note"
            className="t-input"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {error && <p className="t-error mb-3">{error}</p>}

        <button
          className="t-btn t-btn-primary w-full"
          type="submit"
          disabled={saving || uploading}
        >
          Send for approval
        </button>
        <p className="mt-2 mb-3 text-center text-xs text-muted">
          You can log it right away. It reaches everyone once approved.
        </p>

        {conflicted && onConflict && (
          <button type="button" className="t-btn mb-3 w-full" onClick={onConflict}>
            Look it up again
          </button>
        )}
      </form>
    </Sheet>
  )
}
