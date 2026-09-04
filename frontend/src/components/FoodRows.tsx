import { Camera, X } from 'lucide-react'

import type { Community, FoodRow, MealRow, RecipeRow } from '../api'
import { scale, servingsText } from '../lib/units'
import { nutrientText } from './NutritionLabel'

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

// The picture beside a food in a list, or where one would be. Decorative: the
// row itself is what opens the food.
export function PhotoThumb({ url }: { url: string | null }) {
  if (url === null) {
    return (
      <span className="t-phototile h-10 w-10" aria-hidden="true">
        <Camera className="h-4 w-4" strokeWidth={1.75} />
      </span>
    )
  }
  return (
    <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
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

export function FoodLine({
  row,
  onOpen,
  onRemove,
}: {
  row: FoodRow
  onOpen: () => void
  // Taking the row off the list it is in, where that is a thing this list
  // offers. The X sits beside the row rather than inside it, so opening the
  // food and taking it off are two targets and not one.
  onRemove?: () => void
}) {
  const line = (
    <>
      <PhotoThumb url={row.photo_url} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <Dot state={row.community} />
          <span className="truncate text-sm">{row.name}</span>
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
        aria-label={`Take ${row.name} off My foods`}
        onClick={onRemove}
      >
        <X className="h-4 w-4" strokeWidth={2.5} />
      </button>
    </div>
  )
}

export function MealLine({ row, onOpen }: { row: MealRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
      <span className="shrink-0 text-xs text-muted">
        {row.items === 1 ? '1 food' : `${row.items} foods`}
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
