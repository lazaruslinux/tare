import { CalendarSync } from 'lucide-react'
import { useEffect, useState, type ChangeEvent } from 'react'

import { api, dishPhoto, errorText, upload, type AutoLog } from '../api'
import { MAX_PHOTO_BYTES, PHOTO_TOO_LARGE } from '../lib/community'
import { slotByTime, type Slot } from '../lib/day'
import { DISH_ICON, DISH_LABEL } from './FoodRows'
import { Lightbox } from './Lightbox'
import { LogSheet } from './LogSheet'

// The two things a recipe page and a meal page do the same way: the picture of
// what was made, and the standing instruction to log it every day. They live
// here so the two screens cannot drift apart.

type Kind = 'recipe' | 'meal'

// The picture of the finished dish, taken or chosen on its own page the way a
// food's front photo is. One per dish: a second replaces the first, file and
// all, and Remove takes it off.
export function DishPhoto({
  kind,
  id,
  name,
  url,
  onChanged,
}: {
  kind: Kind
  id: number
  name: string
  url: string | null
  // The row has moved, so the page reads it again.
  onChanged: () => Promise<void> | void
}) {
  const Icon = DISH_ICON[kind]
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [viewing, setViewing] = useState(false)
  const field = `dish-photo-${kind}-${id}`

  const take = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (!file) return
    setError('')
    if (file.size > MAX_PHOTO_BYTES) {
      setError(PHOTO_TOO_LARGE)
      return
    }
    setSending(true)
    try {
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file, 'dish')
      await dishPhoto(kind, id, photo_id)
      await onChanged()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  const clear = async () => {
    setSending(true)
    setError('')
    try {
      await dishPhoto(kind, id, null)
      await onChanged()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSending(false)
  }

  return (
    <div className="mb-3 flex items-start gap-3">
      {url === null ? (
        <label className="t-phototile h-24 w-24 cursor-pointer rounded-xl" htmlFor={field}>
          <Icon className="h-6 w-6" strokeWidth={1.75} />
          <span className="sr-only">Add a photo of this {DISH_LABEL[kind].toLowerCase()}</span>
        </label>
      ) : (
        <button
          type="button"
          className="block h-24 shrink-0"
          aria-label="See the picture"
          onClick={() => setViewing(true)}
        >
          <img
            src={url}
            alt={name}
            className="h-24 w-24 rounded-xl border border-line object-cover"
          />
        </button>
      )}
      <input
        id={field}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={sending}
        onChange={(event) => void take(event)}
      />
      {url !== null && (
        <div className="flex items-center gap-3">
          <label
            className="t-tap44 cursor-pointer text-xs font-semibold text-accent"
            htmlFor={field}
          >
            Replace
          </label>
          <button
            type="button"
            className="t-tap44 text-xs font-semibold text-muted"
            disabled={sending}
            onClick={() => void clear()}
          >
            Remove
          </button>
        </div>
      )}
      {error && <p className="t-error">{error}</p>}
      {viewing && url !== null && (
        <Lightbox src={url} alt={name} onClose={() => setViewing(false)} />
      )}
    </div>
  )
}

// The standing instruction, set from the dish's own page the way a food's is
// set from its own. The same sheet that logs it, ending in the meal it lands in
// every day rather than in today's diary.
export function DishAutoLog({
  kind,
  id,
  name,
  weight,
  timezone,
  onChanged,
}: {
  kind: Kind
  id: number
  name: string
  // What the whole thing weighs, so the sheet can offer the scale.
  weight: number | null
  timezone: string
  // The instruction changed, and the Food tab lists it.
  onChanged: () => void
}) {
  const [standing, setStanding] = useState<AutoLog | null>(null)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // The instruction is the member's rather than the dish's, so it is read here
  // rather than carried on the dish.
  const load = () =>
    api<AutoLog[]>('/diary/auto-logs')
      .then((rows) => setStanding(rows.find((row) => row[`${kind}_id`] === id) ?? null))
      .catch(() => {})

  useEffect(() => {
    let alive = true
    api<AutoLog[]>('/diary/auto-logs')
      .then((rows) => alive && setStanding(rows.find((row) => row[`${kind}_id`] === id) ?? null))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [kind, id])

  const save = async (amount: number | null, slot: Slot, byWeight: boolean) => {
    if (amount === null) return
    setSaving(true)
    setError('')
    try {
      await api(standing === null ? '/diary/auto-logs' : `/diary/auto-logs/${standing.id}`, {
        method: standing === null ? 'POST' : 'PATCH',
        body: {
          ...(standing === null ? { [`${kind}_id`]: id } : {}),
          amount,
          unit: byWeight ? 'g' : 'serving',
          slot,
        },
      })
      setOpen(false)
      await load()
      onChanged()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSaving(false)
  }

  // Turning it off. What it has already written down is eaten and stays.
  const stop = async () => {
    if (standing === null) return
    setSaving(true)
    setError('')
    try {
      await api(`/diary/auto-logs/${standing.id}`, { method: 'DELETE' })
      setOpen(false)
      setStanding(null)
      onChanged()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSaving(false)
  }

  return (
    <>
      <button
        className="t-btn"
        type="button"
        aria-pressed={standing !== null}
        onClick={() => {
          setError('')
          setOpen(true)
        }}
      >
        <CalendarSync className="h-4 w-4" strokeWidth={2} />
        Auto-log
      </button>

      {open && (
        <LogSheet
          title="Auto-log"
          action="Auto-log every day"
          deleteLabel="Remove"
          name={name}
          servings={standing?.amount ?? 1}
          counted={standing !== null && standing.unit !== 'g'}
          weighing={standing?.unit === 'g'}
          slot={standing?.slot ?? slotByTime(timezone)}
          weight={weight}
          error={error}
          saving={saving}
          onClose={() => setOpen(false)}
          onSubmit={(amount, slot, byWeight) => void save(amount, slot, byWeight)}
          onDelete={standing === null ? undefined : () => void stop()}
        />
      )}
    </>
  )
}
