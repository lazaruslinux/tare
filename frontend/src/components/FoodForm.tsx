import { ChevronDown, ScanLine } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { ApiError, api, errorText, type Food, type Prefill, type Scanned } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { NO_SERVING, SHARED_FACTS, type Values } from '../lib/community'
import {
  MASS_UNITS,
  UNIT_LABEL,
  UNIT_TO_BASE,
  VOLUME_UNITS,
  round1,
  scale,
  toPer100,
  type BaseUnit,
  type Unit,
} from '../lib/units'
import { BarcodeScanner } from './BarcodeScanner'
import { HEADLINE, MORE_FACTS, type Nutrient } from './NutritionLabel'
import { PhotoSlots } from './PhotoSlots'
import { Sheet } from './Sheet'

// The food form, worked the way a label is read: one serving at a time.
//
// A food is stored per 100 of its base unit, because that is the one figure
// every portion can be worked out from. Nobody reads a package that way. So the
// boxes here are the label's own column, per one serving of it, and the
// arithmetic between the two happens on the way in and on the way out.

// Two ways to measure a food, in the words somebody would use out loud.
const BASES: { value: BaseUnit; title: string; note: string }[] = [
  { value: 'g', title: 'Weight', note: 'grams, ounces' },
  { value: 'ml', title: 'Volume', note: 'mL, fl oz' },
]

// What the switch is for, said once under it. Nobody is asked to fill in a
// number the label does not print: a blank reaches the reviewer as a blank.
const SUBMIT_HELP =
  'Every item you submit makes Tare smarter, faster, and better for the whole ' +
  'community. Attach photos of the item(s) below.'

// Both tiles are asked for while the switch is on, so the refusal is said where
// the tiles are rather than at the bottom with everything else.
const PHOTOS_NEEDED = 'Photos are required to submit to Tare.'

// What somebody is asked before their food stays their own. His decision: the
// one place in tare a question stands between a person and a save.
const KEEP_PRIVATE_ASK =
  "Are you sure you don't want to submit your item to the Tare database? This " +
  'makes Tare smarter, faster, and better for everyone using it.'

// What the serving line reads before somebody has named the serving. A food
// entered from a lookup opens per the source's own 100, which is true until
// they type the words on the package.
const SERVING_PLACEHOLDER = '1 egg, 1 bar, 2 cookies'

// What the server holds a description to. Held here as well, so the box stops
// taking letters rather than the save coming back with a sentence about it.
const MAX_DESCRIPTION = 60

// A serving as somebody types it: the words for it, the number, and the
// unit that number is in. What it comes to in the food's base unit is
// worked out from those, never typed.
type ServingDraft = { name: string; amount: string; unit: Unit }

// The units a food of this class may be served in. Only its own: a serving
// measured across the two families would need a density to mean anything.
const unitsFor = (base: BaseUnit): Unit[] => (base === 'g' ? MASS_UNITS : VOLUME_UNITS)

// A typed field as a number, or nothing. An empty box is a nutrient the label
// did not give, which is not the same as zero of it.
function num(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

// What a typed serving comes to in the food's own base unit, which is what the
// panel underneath it is read against. Null until there is a size to read.
function baseOf(draft: ServingDraft): number | null {
  const amount = num(draft.amount)
  return amount === null || amount <= 0 ? null : amount * UNIT_TO_BASE[draft.unit]
}

// What is stored, as it reads for one serving of this size. Calories whole and
// everything else to a tenth, which is how a label prints them.
function perServingDraft(values: Values, amount: number): Record<Nutrient, string> {
  const draft = {} as Record<Nutrient, string>
  for (const fact of SHARED_FACTS) {
    const each = scale(values[fact.key], amount)
    draft[fact.key] =
      each === null ? '' : String(fact.key === 'calories' ? Math.round(each) : round1(each))
  }
  return draft
}

// The ten as they stand on a food or on a lookup, per 100 of the base unit.
function panelOf(carrier: Food | Prefill | null): Values {
  const values = {} as Values
  for (const fact of SHARED_FACTS) values[fact.key] = carrier === null ? null : carrier[fact.key]
  return values
}

// The serving the whole form is entered per. Position 0 is the label serving
// everywhere in tare, so it is the one this edits. Anything that arrives
// without one is entered per 100 of its base unit, which is what its numbers
// already are.
function startingServing(food: Food | null, prefill: Prefill | null): ServingDraft {
  const first = food?.servings[0]
  // The stored amount in the stored unit, never the base number it came to: a
  // pound of cheese was entered as a pound and is read back as one.
  if (first) return { name: first.name, amount: String(first.amount), unit: first.unit }
  if (prefill) {
    return prefill.serving
      ? {
          name: prefill.serving.name,
          amount: String(prefill.serving.amount),
          unit: prefill.serving.unit,
        }
      : { name: '', amount: '100', unit: prefill.base_unit }
  }
  if (food === null) return { name: '', amount: '', unit: 'g' }
  // A food stored without a serving of its own is read per the 100 it is kept
  // in, with nothing invented for the name of it.
  return { name: '', amount: '100', unit: food.base_unit }
}

// Anything a food carries beyond the label serving. Not shown and not changed:
// they are sent back as they came.
function extraServings(food: Food | null): ServingDraft[] {
  if (!food) return []
  return food.servings
    .slice(1)
    .map((serving) => ({
      name: serving.name,
      amount: String(serving.amount),
      unit: serving.unit,
    }))
}

function startingPanel(
  carrier: Food | Prefill | null,
  serving: ServingDraft
): Record<Nutrient, string> {
  const amount = baseOf(serving)
  if (carrier === null || amount === null) return perServingDraft(panelOf(null), 100)
  return perServingDraft(panelOf(carrier), amount)
}

export function FoodForm({
  food,
  notice,
  title,
  backLabel,
  complete,
  submitDefault,
  inSheet,
  prefill,
  scannedBarcode,
  onSaved,
  onCancel,
  onOpenFood,
  onConflict,
}: {
  food: Food | null
  // Why somebody was sent here, when something else sent them. Said at the top
  // and the panel opened underneath it, so the box it is about is on screen.
  notice?: string
  title?: string
  // What the screen behind this one is called. The form is opened from a
  // list, from a food, and from the queue, and each of them is a different
  // place to be sent back to.
  backLabel: string
  // Every box is going to be looked at, so none of them opens behind a fold.
  // What a reviewer adjusting a proposal wants.
  complete?: boolean
  // Whether the switch starts on. A scan means somebody is holding a package
  // nobody has entered yet, which is the case the database is built out of.
  submitDefault?: boolean
  // Drawn inside a sheet, which carries its own header and its own way out.
  inSheet?: boolean
  // What a lookup already answered, for a form opened by a scan rather than by
  // somebody deciding to type a food in.
  prefill?: Prefill | null
  // The code that scan read, held still the way an in-form scan holds one.
  scannedBarcode?: string | null
  onSaved: (food: Food) => void
  onCancel: () => void
  // Where a scanned code that is already in tare sends somebody. Given only
  // where scanning makes sense, which is a food being entered for the first
  // time, and it is what puts the scan button on the form.
  onOpenFood?: (id: number) => void
  // The barcode was claimed by the Tare database while this was open. The scan
  // is worth resolving again rather than arguing with.
  onConflict?: () => void
}) {
  // The food being changed, or the lookup a scan came back with, or neither.
  const opening = food ?? prefill ?? null
  const [name, setName] = useState(opening?.name ?? '')
  const [brand, setBrand] = useState(opening?.brand ?? '')
  // Only a food carries one. A barcode lookup has nothing to say here, so a
  // scanned form opens with it blank.
  const [description, setDescription] = useState(food?.description ?? '')
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(opening?.base_unit ?? 'g')
  const [ingredients, setIngredients] = useState(opening?.ingredients_text ?? '')
  const [serving, setServingRow] = useState<ServingDraft>(() =>
    startingServing(food, prefill ?? null)
  )
  const [extras] = useState<ServingDraft[]>(() => extraServings(food))
  const [panel, setPanel] = useState(() =>
    startingPanel(opening, startingServing(food, prefill ?? null))
  )
  // Not a box any more. A lookup that worked one out is sent back as it came,
  // and nothing on this screen asks anybody for one.
  const [density, setDensity] = useState<number | null>(opening?.density_g_per_ml ?? null)
  const [note, setNote] = useState('')
  // Opened when every box is going to be asked for anyway, so nothing that is
  // needed is behind a fold.
  const [more, setMore] = useState(
    Boolean(notice) || Boolean(complete) || Boolean(submitDefault)
  )
  const [error, setError] = useState('')
  // Said under the tiles rather than with the rest, because that is where the
  // two things it is about are.
  const [photoError, setPhotoError] = useState('')
  // Open while somebody is being asked whether they really mean to keep a food
  // to themselves.
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [looking, setLooking] = useState(false)
  const [barcode, setBarcode] = useState(scannedBarcode ?? '')
  // A code a lookup answered is the package's own, so it is held still until
  // somebody says otherwise. A code nothing was found for is a code worth
  // checking, so it opens editable.
  const [locked, setLocked] = useState(Boolean(scannedBarcode) && Boolean(prefill))
  // The food this code already is, when the scan turned one up. Nothing is
  // created for it: it is there to be opened.
  const [already, setAlready] = useState<{ id: number; name: string } | null>(null)
  const [submitOn, setSubmitOn] = useState(submitDefault ?? food === null)
  const [photoId, setPhotoId] = useState<number | null>(null)
  const [labelPhotoId, setLabelPhotoId] = useState<number | null>(null)
  const [conflicted, setConflicted] = useState(false)
  // Where a lookup filled the boxes in, so they can be checked against the
  // packaging they claim to describe.
  const [source, setSource] = useState(prefill?.source ?? '')
  // What a lookup gave, per 100, kept so the boxes can follow the serving size
  // while they are still nobody's own work. Null once somebody types.
  const [basis, setBasis] = useState<Values | null>(prefill ? panelOf(prefill) : null)

  // A food being entered for the first time. Everywhere else this form is
  // opened on a food that already exists, or on a proposal about one.
  const creating = food === null
  // One of your own foods, open to be changed. This is where its pictures and
  // the switch live: it is the only screen that has both the panel and them,
  // so submitting again is the same form as correcting it.
  const own = food !== null && food.mine
  // The switch is not offered while a decision is outstanding: there is
  // nothing to send until that one is answered or taken back.
  const offerable = creating || (own && food.status !== 'pending')
  const scannable = onOpenFood !== undefined && food === null

  const heading = title ?? (food ? 'Edit food' : 'New food')
  useTopBar(inSheet ? null : { title: heading, back: { label: backLabel, onBack: onCancel } })

  const setFact = (key: Nutrient, value: string) => {
    setPanel({ ...panel, [key]: value })
    // From here the numbers are somebody's own, and a serving size typed after
    // them changes what they are per, not what they say.
    setBasis(null)
  }

  const setServing = (draft: ServingDraft) => {
    setServingRow(draft)
    const amount = baseOf(draft)
    // Still the lookup's numbers, so they follow the serving they are read
    // against: a panel per 100 g reads per the slice as soon as it is named,
    // and reads per the pound as soon as the unit beside it says pound.
    if (basis !== null && amount !== null) setPanel(perServingDraft(basis, amount))
  }

  // The unit belongs to the class, so switching Measured by starts it over at
  // that class's own base and leaves the number somebody typed alone.
  const setBase = (next: BaseUnit) => {
    setBaseUnit(next)
    if (next !== baseUnit) setServing({ ...serving, unit: next })
  }

  // What a lookup gives, put into the boxes it fills. Anything the reading did
  // not carry is left alone rather than blanked: an empty box is a number
  // nobody has, which is what it already was.
  const fill = (reading: Prefill) => {
    setName(reading.name)
    setBrand(reading.brand)
    setBaseUnit(reading.base_unit)
    setIngredients(reading.ingredients_text)
    setSource(reading.source)
    setDensity(reading.density_g_per_ml)
    const read = {} as Values
    for (const fact of SHARED_FACTS) read[fact.key] = reading[fact.key]
    const seeded: ServingDraft = reading.serving
      ? {
          name: reading.serving.name,
          amount: String(reading.serving.amount),
          unit: reading.serving.unit,
        }
      : { name: '', amount: '100', unit: reading.base_unit }
    setServingRow(seeded)
    setBasis(read)
    setPanel(perServingDraft(read, baseOf(seeded) ?? 100))
    setMore(true)
  }

  const resolve = async (code: string) => {
    setScanning(false)
    setLooking(true)
    setError('')
    setAlready(null)
    try {
      const answer = await api<Scanned>(`/barcode/${code}`)
      if (answer.state === 'approved' || answer.state === 'mine') {
        setAlready({ id: answer.food.id, name: answer.food.name })
      } else if (answer.state === 'prefill') {
        setBarcode(answer.prefill.barcode ?? code)
        setLocked(true)
        fill(answer.prefill)
      } else {
        // Nothing found. The code stays as it was read and stays editable: a
        // scan that answers nothing is the one worth checking a digit of.
        setBarcode(answer.barcode)
      }
    } catch (failure) {
      setError(errorText(failure))
    }
    setLooking(false)
  }

  // The form as it stands, sent. Whether it goes to the review queue is the
  // one thing this is told rather than reads: the switch may have been turned
  // on by the sheet a moment ago, and a state set then is not readable here.
  const send = async (on: boolean) => {
    setAsking(false)
    const typed = num(serving.amount)
    if (!serving.name.trim() || typed === null || typed <= 0) {
      setError(NO_SERVING)
      return
    }
    // Nothing is sent without both pictures, because the reviewer has only
    // them to check the numbers against.
    if (on && (creating || own)) {
      // The front may already be on the food, which counts. The label belongs
      // to the request, so it is asked for every time.
      const standing = own ? (food?.photo_url ?? null) : null
      if (labelPhotoId === null || (photoId === null && standing === null)) {
        setPhotoError(PHOTOS_NEEDED)
        return
      }
    }
    setPhotoError('')
    // What the boxes are per, in the food's base unit. The server works the
    // same sum from the amount and the unit that are sent to it.
    const size = typed * UNIT_TO_BASE[serving.unit]

    // What is in the boxes, which is per one serving.
    const read = {} as Values
    for (const fact of SHARED_FACTS) read[fact.key] = num(panel[fact.key])

    // Untouched, so what the lookup gave is what is stored: rounding a panel
    // to a tenth and back again is drift nobody asked for.
    const stored = {} as Values
    for (const fact of SHARED_FACTS) {
      stored[fact.key] = basis === null ? toPer100(read[fact.key], size) : basis[fact.key]
    }

    setSaving(true)
    setError('')
    setConflicted(false)
    const body: Record<string, unknown> = {
      name,
      brand,
      description,
      base_unit: baseUnit,
      density_g_per_ml: density,
      ingredients_text: ingredients,
      servings: [
        { name: serving.name, amount: typed, unit: serving.unit, position: 0 },
        ...extras.map((row, index) => ({
          name: row.name,
          amount: num(row.amount) ?? 0,
          unit: row.unit,
          position: index + 1,
        })),
      ],
      ...stored,
    }
    // Only on a food being entered for the first time. The code is what this
    // row was scanned from, and an edit never moves it.
    if (creating && barcode.trim()) body.barcode = barcode.trim()
    if (creating && on) body.note = note

    try {
      if (creating && on) {
        const answer = await api<{ food: Food }>('/submissions/food', {
          method: 'POST',
          body: { ...body, photo_id: photoId, label_photo_id: labelPhotoId },
        })
        onSaved(answer.food)
        return
      }
      const write = (payload: Record<string, unknown>) =>
        api<Food>(food ? `/foods/${food.id}` : '/foods', {
          method: food ? 'PATCH' : 'POST',
          body: payload,
        })
      let saved = await write(body)
      if (own && food !== null) {
        // The corrections first, then the picture, then the offer: what goes
        // for review is the food as it stands after this form. A new front
        // photo replaces the one it was carrying.
        if (photoId !== null) {
          await api(`/foods/${food.id}/photo`, { method: 'POST', body: { photo_id: photoId } })
          saved = await api<Food>(`/foods/${food.id}`)
        }
        if (on) {
          const answer = await api<{ food: Food }>(`/foods/${food.id}/submit`, {
            method: 'POST',
            body: { note, label_photo_id: labelPhotoId },
          })
          saved = answer.food
        }
        onSaved(saved)
        return
      }
      if (creating && photoId !== null) {
        // The food is written by now. A picture that will not go on is worth
        // less than the food, so it is not what somebody is told about: it can
        // be taken again from the food's own page.
        try {
          await api(`/foods/${saved.id}/photo`, { method: 'POST', body: { photo_id: photoId } })
          saved = await api<Food>(`/foods/${saved.id}`)
        } catch {
          // Left as it is.
        }
      }
      onSaved(saved)
    } catch (failure) {
      setError(errorText(failure))
      // Read off the status rather than the sentence: the wording is the
      // server's to change.
      setConflicted(failure instanceof ApiError && failure.status === 409)
      setSaving(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // The one question tare asks before a save. Somebody keeping a food to
    // themselves is doing something the database cannot get back, so it is
    // worth one sentence.
    if (offerable && !submitOn) {
      setAsking(true)
      return
    }
    void send(submitOn)
  }

  if (scanning) {
    return (
      <BarcodeScanner onCode={(code) => void resolve(code)} onClose={() => setScanning(false)} />
    )
  }

  // What the button does, said in the word for it: a food that has been offered
  // before is being offered again.
  const action =
    offerable && submitOn
      ? food !== null && food.submissions.length > 0
        ? 'Resubmit'
        : 'Submit'
      : 'Save'

  const sized = num(serving.amount)
  const size = sized !== null && sized > 0 ? ` (${sized} ${UNIT_LABEL[serving.unit]})` : ''
  // Never what the numbers are stored per. The words on the package where
  // somebody has typed them, and the size on its own until they do.
  const per = `Per ${serving.name.trim() || 'serving'}${size}`

  return (
    <>
      {inSheet && <p className="t-micro mb-2">{heading}</p>}
      {notice && <p className="t-card mb-3 text-sm text-muted">{notice}</p>}

      {already !== null && (
        <div className="t-card mb-3">
          <p className="text-sm">Already in Tare: {already.name}</p>
          <button
            type="button"
            className="t-btn mt-3"
            onClick={() => onOpenFood?.(already.id)}
          >
            Open
          </button>
        </div>
      )}

      <form onSubmit={submit}>
        <div className="t-card mb-3">
          {/* Always there on a food being entered, empty or not: a code is
              typed as readily as it is scanned, and a form that hides the box
              until a camera has been pointed at something says otherwise. */}
          {(creating || barcode) && (
            <div className="mb-3">
              <label className="t-label" htmlFor="food-barcode">
                Barcode (optional)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="food-barcode"
                  className="t-input t-nums min-w-0 flex-1"
                  inputMode="numeric"
                  readOnly={locked}
                  value={barcode}
                  onChange={(event) => setBarcode(event.target.value)}
                />
                {locked ? (
                  <button
                    type="button"
                    className="t-tap44 shrink-0 px-1 text-sm font-semibold text-accent"
                    onClick={() => setLocked(false)}
                  >
                    Change
                  </button>
                ) : (
                  scannable && (
                    <button
                      type="button"
                      className="t-btn shrink-0"
                      disabled={looking}
                      onClick={() => setScanning(true)}
                    >
                      <ScanLine className="h-4 w-4" strokeWidth={2} />
                      {looking ? 'Looking it up' : 'Scan'}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          <div className="mb-3">
            <label className="t-label" htmlFor="food-name">
              Name
            </label>
            <input
              id="food-name"
              className="t-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="mb-3">
            <label className="t-label" htmlFor="food-brand">
              Brand (optional)
            </label>
            <input
              id="food-brand"
              className="t-input"
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
            />
          </div>
          <div>
            <label className="t-label" htmlFor="food-description">
              Description (optional)
            </label>
            <input
              id="food-description"
              className="t-input"
              maxLength={MAX_DESCRIPTION}
              placeholder="King Size, Blueberry flavor"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {source && (
            <p className="mt-3 text-xs text-muted">
              Filled in from {source}. Check every number against the package.
            </p>
          )}
        </div>

        <div className="mb-3">
          <p className="t-micro mb-2">Measured by</p>
          <div className="flex gap-3">
            {BASES.map((base) => (
              <button
                key={base.value}
                type="button"
                aria-pressed={baseUnit === base.value}
                className="t-choice"
                onClick={() => setBase(base.value)}
              >
                <span className="block text-sm font-semibold">{base.title}</span>
                <span className="block text-xs">{base.note}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="t-card mb-3">
          <p className="t-micro mb-1">Serving size</p>
          <div className="t-row mb-3">
            <input
              className="t-input min-w-0 flex-1"
              placeholder={SERVING_PLACEHOLDER}
              aria-label="Serving name"
              value={serving.name}
              onChange={(event) => setServing({ ...serving, name: event.target.value })}
            />
            <input
              className="t-input t-nums w-20 text-right"
              inputMode="decimal"
              placeholder="19"
              aria-label="Serving size"
              value={serving.amount}
              onChange={(event) => setServing({ ...serving, amount: event.target.value })}
            />
            <select
              className="t-input t-nums w-24 shrink-0"
              aria-label="Serving unit"
              value={serving.unit}
              onChange={(event) =>
                setServing({ ...serving, unit: event.target.value as Unit })
              }
            >
              {unitsFor(baseUnit).map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_LABEL[unit]}
                </option>
              ))}
            </select>
          </div>

          <p className="t-label mb-1">{per}</p>
          {HEADLINE.map((fact) => (
            <div key={fact.key} className="t-row">
              <label className="flex-1 text-sm" htmlFor={`food-${fact.key}`}>
                {fact.label}
                {fact.unit && <span className="text-muted"> ({fact.unit})</span>}
              </label>
              <input
                id={`food-${fact.key}`}
                className="t-input t-nums max-w-[40%] text-right"
                inputMode="decimal"
                value={panel[fact.key]}
                onChange={(event) => setFact(fact.key, event.target.value)}
              />
            </div>
          ))}

          <button
            type="button"
            className="t-micro mt-3 flex items-center gap-1"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            More facts
            <ChevronDown className={`h-3.5 w-3.5 ${more ? 'rotate-180' : ''}`} strokeWidth={2.5} />
          </button>

          {more && (
            <div className="mt-1">
              {MORE_FACTS.map((fact) => (
                <div key={fact.key} className="t-row">
                  <label className="flex-1 text-sm" htmlFor={`food-${fact.key}`}>
                    {fact.label} <span className="text-muted">({fact.unit})</span>
                  </label>
                  <input
                    id={`food-${fact.key}`}
                    className="t-input t-nums max-w-[40%] text-right"
                    inputMode="decimal"
                    value={panel[fact.key]}
                    onChange={(event) => setFact(fact.key, event.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {offerable && (
          <div className="t-card mb-3">
            <label className="t-row text-sm">
              <span className="flex-1">Submit to Tare</span>
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={submitOn}
                onChange={(event) => {
                  setSubmitOn(event.target.checked)
                  setPhotoError('')
                }}
              />
            </label>
            <p className="mt-2 text-xs text-muted">{SUBMIT_HELP}</p>
          </div>
        )}

        {(creating || own) && (
          <>
            <PhotoSlots
              front={{ id: photoId, url: food?.photo_url, required: submitOn }}
              label={{ id: labelPhotoId, required: submitOn }}
              busy={saving}
              onFront={(id) => {
                setPhotoId(id)
                setPhotoError('')
              }}
              onLabel={(id) => {
                setLabelPhotoId(id)
                setPhotoError('')
              }}
              onFailed={setError}
            />
            {photoError && <p className="t-error mb-3">{photoError}</p>}
          </>
        )}

        {offerable && submitOn && (
          <div className="t-card mb-3">
            <label className="t-label" htmlFor="food-note">
              Comment (optional)
            </label>
            <input
              id="food-note"
              className="t-input"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}

        {error && <p className="t-error mb-3">{error}</p>}

        <div className="t-actions mb-3">
          <button className="t-btn t-btn-primary flex-1" type="submit" disabled={saving}>
            {action}
          </button>
          <button className="t-btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>

        {conflicted && onConflict && (
          <button type="button" className="t-btn mb-3 w-full" onClick={onConflict}>
            Look it up again
          </button>
        )}
      </form>

      <Sheet open={asking} label="Submit to Tare" onClose={() => setAsking(false)}>
        <p className="text-sm">{KEEP_PRIVATE_ASK}</p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            disabled={saving}
            onClick={() => {
              setSubmitOn(true)
              void send(true)
            }}
          >
            Submit to Tare
          </button>
          <button
            type="button"
            className="t-btn"
            disabled={saving}
            onClick={() => void send(false)}
          >
            Keep it private
          </button>
        </div>
      </Sheet>
    </>
  )
}
