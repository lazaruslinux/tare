import { BadgeCheck, Camera, X } from 'lucide-react'
import { useState } from 'react'

import {
  errorText,
  type Community,
  type FoodRow,
  type MealRow,
  type RecipeRow,
  type RepeatRow,
} from '../api'
import { scale, servingsText } from '../lib/units'
import { nutrientText } from './NutritionLabel'
import { Sheet } from './Sheet'

// The three rows a member's own lists are made of, in one place because the
// Food page's cards and the list screen behind them show the same rows and
// must not drift apart.

// The line under a food's name: who makes it and what it is, whichever of the
// two it carries. Every list reads it the same way, so a food looks like itself
// wherever it turns up.
export function subline(row: FoodRow): string {
  return [row.brand, row.description].filter(Boolean).join(' \u00b7 ')
}

// Where a food stands with the shared database, as one dot before its name.
// A word for each of these on every row would be a column of shouting; the
// colour carries it and the label is there for anybody reading with their ears.
// A food already in the database wears the check instead, so the dots are only
// ever a member's own food on its way there.
const DOTS: Record<Community, { label: string; look: string }> = {
  none: { label: 'Not submitted', look: 'border border-line-strong' },
  pending: { label: 'Waiting for review', look: 'bg-pending' },
  approved: { label: 'Approved', look: 'bg-accent' },
  rejected: { label: 'Not approved', look: 'bg-danger' },
}

export function Dot({ state }: { state: Community }) {
  const dot = DOTS[state]
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${dot.look}`}
      role="img"
      aria-label={dot.label}
    />
  )
}

// The mark a food in the Tare database wears, after its name, everywhere its
// name is read. One mark, one meaning: this one is the database's, not yours.
export function Verified({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <BadgeCheck
      className={`${className} shrink-0 text-accent`}
      strokeWidth={2.25}
      role="img"
      aria-label="In the Tare database"
    />
  )
}

// The picture beside a food in a list, or where one would be. Decorative: the
// row itself is what opens the food.
//
// The small copy where the server has written one, which is the whole picture
// again on a food photographed before there were any. Loaded lazily, so a list
// of three hundred rows fetches the dozen somebody is looking at.
export function PhotoThumb({ row }: { row: FoodRow }) {
  const url = row.thumb_url ?? row.photo_url
  if (url === null) {
    return (
      <span className="t-phototile h-10 w-10" aria-hidden="true">
        <Camera className="h-4 w-4" strokeWidth={1.75} />
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover"
    />
  )
}

// What a food is worth, per the thing somebody eats. The label serving where
// there is one; where there is not, the 100 it is stored in, named as the
// serving it stands in for rather than as the way the row is kept.
export function Calories({ row }: { row: FoodRow }) {
  const serving = row.serving
  const value = serving === null ? row.calories : scale(row.calories, serving.base_amount)
  return (
    <span className="shrink-0 text-right">
      <span className="t-nums block text-sm">{nutrientText('calories', value)} cal</span>
      <span className="block text-xs text-muted">
        {serving === null ? `per serving (100 ${row.base_unit})` : `per ${serving.name}`}
      </span>
    </span>
  )
}

// The starred foods out of everything the repeat list offers, in the order
// somebody reaches for them: what was eaten most recently, then by name for the
// ones nobody has logged yet.
export function favoritesOf(rows: RepeatRow[]): RepeatRow[] {
  return rows
    .filter((row) => row.pinned)
    .sort(
      (one, two) =>
        (two.last_logged ?? '').localeCompare(one.last_logged ?? '') ||
        one.name.localeCompare(two.name)
    )
}

export function FoodLine({
  row,
  onOpen,
  onRemove,
  removeLabel,
}: {
  row: FoodRow
  onOpen: () => void
  // Taking the row off the list it is in, where that is a thing this list
  // offers. The X sits beside the row rather than inside it, so opening the
  // food and taking it off are two targets and not one.
  onRemove?: () => void
  // What the X says it does, for a list where taking a row off is not taking
  // it off My foods.
  removeLabel?: string
}) {
  const line = (
    <>
      <PhotoThumb row={row} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {row.status !== 'approved' && <Dot state={row.community} />}
          <span className="truncate text-sm">{row.name}</span>
          {row.status === 'approved' && <Verified />}
        </span>
        {subline(row) && (
          <span className="block truncate text-xs text-muted">{subline(row)}</span>
        )}
      </span>
      <Calories row={row} />
    </>
  )
  if (onRemove === undefined) {
    return (
      <button type="button" className="t-row w-full text-left" onClick={onOpen}>
        {line}
      </button>
    )
  }
  return (
    <div className="t-row">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={onOpen}
      >
        {line}
      </button>
      <button
        type="button"
        className="t-tap44 shrink-0 text-muted"
        aria-label={removeLabel ?? `Take ${row.name} off My foods`}
        onClick={onRemove}
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}

// The question before a shared food comes off a member's list. Asked rather
// than undone, because the list is the member's own and the food itself is
// not going anywhere: it stays in the Tare database to be added back.
export function RemoveKeptSheet({
  row,
  onCancel,
  onRemove,
}: {
  row: FoodRow | null
  onCancel: () => void
  onRemove: (row: FoodRow) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Sheet
      center
      open={row !== null}
      label="Remove from your foods?"
      onClose={() => {
        if (!busy) onCancel()
      }}
    >
      <p className="text-base font-semibold tracking-tight">Remove from your foods?</p>
      {row !== null && <p className="mt-1 text-sm">{row.name}</p>}
      <p className="mt-2 text-sm text-muted">
        You can always add it back from the Tare database.
      </p>
      {error && <p className="t-error mt-2">{error}</p>}
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className="t-btn t-btn-primary flex-1"
          disabled={busy}
          onClick={() => {
            if (row === null) return
            setBusy(true)
            setError('')
            onRemove(row).then(
              () => setBusy(false),
              (failure) => {
                setError(errorText(failure))
                setBusy(false)
              }
            )
          }}
        >
          Remove
        </button>
        <button type="button" className="t-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  )
}

export function MealLine({ row, onOpen }: { row: MealRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
      <span className="t-nums shrink-0 text-xs text-muted">
        {row.items === 1 ? '1 food' : `${row.items} foods`} ·{' '}
        {nutrientText('calories', row.totals.calories)} cal
      </span>
    </button>
  )
}

export function RecipeLine({ row, onOpen }: { row: RecipeRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{row.name}</span>
        <span className="block truncate text-xs text-muted">
          Makes {servingsText(row.yield_servings)}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="t-nums block text-sm">
          {nutrientText('calories', row.per_serving.calories)} cal
        </span>
        <span className="block text-xs text-muted">per serving</span>
      </span>
    </button>
  )
}
