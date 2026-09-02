import { Camera } from 'lucide-react'

import type { Community, FoodRow, MealRow, RecipeRow } from '../api'
import { servingsText } from '../lib/units'
import { nutrientText } from './NutritionLabel'

// The three rows a member's own lists are made of, in one place because the
// Food page's cards and the list screen behind them show the same rows and
// must not drift apart.

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

export function FoodLine({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <PhotoThumb url={row.photo_url} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <Dot state={row.community} />
          <span className="truncate text-sm">{row.name}</span>
        </span>
        {row.brand && <span className="block truncate text-xs text-muted">{row.brand}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="t-nums block text-sm">
          {row.calories === null ? '-' : Math.round(row.calories)} cal
        </span>
        <span className="block text-xs text-muted">per 100 {row.base_unit}</span>
      </span>
    </button>
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
