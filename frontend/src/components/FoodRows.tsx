import { BadgeCheck, Camera, CookingPot, UtensilsCrossed, X } from 'lucide-react'

import type {
  Community,
  FoodRow,
  LabelServing,
  MealRow,
  Part,
  RecipeRow,
  RepeatRow,
} from '../api'
import { portionText, scale, servingsText } from '../lib/units'
import { nutrientText } from './NutritionLabel'

// The rows a member's own lists are made of, in one place because the Food
// page's cards, the list screen behind them, and the recipe and meal screens
// show the same rows and must not drift apart.

// The line under a food's name: who makes it and what it is, whichever of the
// two it carries. Every list reads it the same way, so a food looks like itself
// wherever it turns up, a row still being filled in included.
export function subline(row: { brand: string; description: string }): string {
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
export function Thumb({ url }: { url: string | null }) {
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

export function PhotoThumb({ row }: { row: FoodRow }) {
  return <Thumb url={row.thumb_url ?? row.photo_url} />
}

// What a recipe and a kept meal are drawn with wherever one is not a food: a
// pot for something cooked, a plate for a list of things eaten together. The
// colour is the second cue and never the only one, so the icon carries it.
export const DISH_ICON = { recipe: CookingPot, meal: UtensilsCrossed }
export const DISH_LABEL = { recipe: 'Recipe', meal: 'Meal' }
export const DISH_TINT = { recipe: 'text-accent', meal: 'text-orange' }

type Dish = 'recipe' | 'meal'

// The picture beside a recipe or a meal in a list, or the empty tile with its
// own icon where nobody has photographed it yet.
export function DishThumb({ kind, url }: { kind: Dish; url: string | null }) {
  const Icon = DISH_ICON[kind]
  if (url === null) {
    return (
      <span className="t-phototile h-10 w-10" aria-hidden="true">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
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

// What a row is, said where the Tare check sits on a food: the icon and the
// word, so nobody has to read the colour to know which of the three this is.
export function KindMark({ kind }: { kind: Dish }) {
  const Icon = DISH_ICON[kind]
  return (
    <span className={`flex shrink-0 items-center gap-1 ${DISH_TINT[kind]}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
      <span className="text-xs font-semibold">{DISH_LABEL[kind]}</span>
    </span>
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
      <span className="block text-xs text-muted">{per(row, serving)}</span>
    </span>
  )
}

// What the figure above is per. A recipe row is already one serving of it and a
// meal row is the whole meal, so neither reads as a hundred of anything.
function per(row: FoodRow, serving: LabelServing | null): string {
  if (row.kind === 'recipe') return 'per serving'
  if (row.kind === 'meal') return 'whole meal'
  return serving === null ? `per serving (100 ${row.base_unit})` : `per ${serving.name}`
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
  // What the X says it does, where the list wants its own words for it.
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
        aria-label={removeLabel ?? `Remove ${row.name} from Favorites`}
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
      <DishThumb kind="meal" url={row.thumb_url ?? row.photo_url} />
      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
      <span className="t-nums shrink-0 text-xs text-muted">
        {row.items === 1 ? '1 food' : `${row.items} foods`} ·{' '}
        {nutrientText('calories', row.totals.calories)} cal
      </span>
    </button>
  )
}

// One thing inside a recipe or a kept meal, drawn the way a food is drawn
// everywhere else: the same thumb, the same check on a food the database holds,
// the brand under the name, and on the right how much of it over what it came
// to. Nothing here opens: the row is a reading, not a way in.
export function PartLine({ row }: { row: Part & { calories: number | null } }) {
  const gone = row.food_id === null
  const under = [row.brand, row.description, gone ? 'this food is gone' : '']
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="t-row">
      <Thumb url={row.thumb_url} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm">{row.name}</span>
          {row.status === 'approved' && <Verified />}
        </span>
        {under && <span className="block truncate text-xs text-muted">{under}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="t-nums block text-xs text-muted">{portionText(row)}</span>
        <span className="t-nums block text-sm">{nutrientText('calories', row.calories)}</span>
      </span>
    </div>
  )
}

export function RecipeLine({ row, onOpen }: { row: RecipeRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <DishThumb kind="recipe" url={row.thumb_url ?? row.photo_url} />
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
