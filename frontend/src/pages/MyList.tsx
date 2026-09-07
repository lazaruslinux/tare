import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { FoodRow, MealRow, MyFoodRow, RecipeRow, RepeatRow } from '../api'
import {
  DISH_ICON,
  DISH_LABEL,
  FoodLine,
  MealLine,
  RecipeLine,
} from '../components/FoodRows'
import { servingsText } from '../lib/units'

// Everything a member has of one kind, in a sheet over the Food tab. The page
// shows the few they are most likely to want; this is where the other three
// hundred live, and the only work it does is narrowing a list it was handed.
// Nothing here asks the server anything: the page above has already read the
// list, and a filter that goes back over the network is a filter that stutters.

export type ListKind = 'foods' | 'favorites' | 'meals' | 'recipes'

export const LIST_TITLE: Record<ListKind, string> = {
  foods: 'Recently used',
  favorites: 'Favorites',
  meals: 'My meals',
  recipes: 'My recipes',
}

// The one that is on when nothing has been picked.
type Chip = 'all' | 'pending' | 'approved' | 'rejected'

const CHIPS: { key: Chip; label: string; empty: string }[] = [
  { key: 'all', label: 'All', empty: 'Nothing here yet.' },
  { key: 'pending', label: 'Waiting', empty: 'Nothing waiting.' },
  { key: 'approved', label: 'Approved', empty: 'Nothing approved yet.' },
  { key: 'rejected', label: 'Not approved', empty: 'Nothing was turned down.' },
]

// Where the search box takes focus on its own. A phone would answer that with
// the keyboard over half the screen before anybody asked for it.
const ROOMY = '(min-width: 900px)'

// How many rows are drawn before the rest are one tap away. Everything is
// already here: this is about how much of it lands on the screen at once.
const PAGE = 30

// Which way the recipes and the meals are read, remembered between visits. A
// cookbook is looked through by its pictures and a list is read by its names,
// and which of the two somebody wants is theirs to say.
const VIEW_KEY = 'tare.dishes.view'
type View = 'list' | 'grid'

function keptView(): View | null {
  try {
    const kept = window.localStorage.getItem(VIEW_KEY)
    return kept === 'list' || kept === 'grid' ? kept : null
  } catch {
    // A browser that will not store anything is a browser that reads the list
    // the way this screen would have opened it anyway.
    return null
  }
}

function keepView(view: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view)
  } catch {
    // Nothing to do about it, and nothing worth saying on screen.
  }
}

// One cell of the catalog: the square picture or the empty tile with its own
// icon, the name under it, and what it is in a corner. The tint is the second
// cue and never the only one.
function DishCell({
  kind,
  name,
  under,
  url,
  onOpen,
}: {
  kind: 'recipe' | 'meal'
  name: string
  under: string
  url: string | null
  onOpen: () => void
}) {
  const Icon = DISH_ICON[kind]
  const frame = kind === 'recipe' ? 'border-accent/40' : 'border-orange/40'
  return (
    <button type="button" className="min-w-0 text-left" onClick={onOpen}>
      <span className="relative block">
        {url === null ? (
          <span
            className={`t-phototile aspect-square w-full rounded-xl border ${frame}`}
            aria-hidden="true"
          >
            <Icon className="h-7 w-7" strokeWidth={1.5} />
          </span>
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className={`aspect-square w-full rounded-xl border object-cover ${frame}`}
          />
        )}
        <span className="t-chip absolute top-1.5 left-1.5 text-xs">{DISH_LABEL[kind]}</span>
      </span>
      <span className="mt-1 block truncate text-sm">{name}</span>
      <span className="block truncate text-xs text-muted">{under}</span>
    </button>
  )
}

// The rows, told apart by which list this is. One shape at a time on screen,
// so the kind decides the row and the filters alike.
export type Listed =
  | { kind: 'foods'; rows: MyFoodRow[] }
  | { kind: 'favorites'; rows: RepeatRow[] }
  | { kind: 'meals'; rows: MealRow[] }
  | { kind: 'recipes'; rows: RecipeRow[] }

function folded(text: string): string {
  return text.trim().toLowerCase()
}

export function MyList({
  listed,
  onClose,
  onOpen,
  onAdd,
  onRemove,
}: {
  listed: Listed
  onClose: () => void
  onOpen: (id: number) => void
  // Taking a row off the list, the same way the card above does it. Absent on
  // the lists where a row is not taken off anything.
  onRemove?: (row: FoodRow) => void
  // The same thing the card's plus does, in the header of the sheet that grew
  // out of that card. Absent where the card has no plus.
  onAdd?: () => void
}) {
  const [query, setQuery] = useState('')
  const [chip, setChip] = useState<Chip>('all')
  const [page, setPage] = useState(PAGE)
  const box = useRef<HTMLInputElement>(null)
  // Only the recipes and the meals are read two ways. What somebody chose last
  // wins; failing that, a catalog where there is anything to look at.
  const dishes = listed.kind === 'meals' || listed.kind === 'recipes'
  const [view, setView] = useState<View>(
    () =>
      keptView() ??
      (listed.rows.some((row) => ((row as MealRow).thumb_url ?? row.photo_url) !== null)
        ? 'grid'
        : 'list')
  )
  const choose = (next: View) => {
    setView(next)
    keepView(next)
  }

  useEffect(() => {
    if (window.matchMedia(ROOMY).matches) box.current?.focus()
  }, [])

  // Two of the four lists are made of foods, and read the same way.
  const foodish = listed.kind === 'foods' || listed.kind === 'favorites'

  const needle = folded(query)
  // In the order the card above shows them, which is what was eaten last. One
  // list, one order: a catalog that reshuffled what the card led with would be
  // a second list wearing the same name. Looking a name up is what the box is
  // for.
  const shown = listed.rows.filter((row) => {
    const name = folded(row.name)
    // Only a food has a brand and a description, and a search reads both as
    // part of the name.
    const about = foodish
      ? folded(`${(row as FoodRow).brand} ${(row as FoodRow).description}`)
      : ''
    if (needle && !name.includes(needle) && !about.includes(needle)) return false
    if (listed.kind === 'foods' && chip !== 'all') {
      return (row as MyFoodRow).community === chip
    }
    return true
  })

  // Why the screen is empty, in the words of whichever filter emptied it. The
  // one somebody just touched is the one they want answered.
  const nothing = needle
    ? 'Nothing here goes by that name.'
    : (CHIPS.find((one) => one.key === chip)?.empty ?? 'Nothing here yet.')

  // Back to the first page whenever the list under it is a different question's
  // answer, so nobody is left looking at row 200 of thirty results.
  useEffect(() => {
    setPage(PAGE)
  }, [needle, chip])
  const drawn = shown.slice(0, page)

  return (
    <>
      {/* The sheet's own bar. It takes the sheet's own padding with it, and
          sticks a padding's worth above the content edge, so the list scrolls
          under it and never past it. */}
      <div className="sticky -top-4 z-10 -mx-4 -mt-4 flex items-center gap-2 bg-surface px-4 pt-4 pb-3">
        <p className="min-w-0 flex-1 truncate text-base font-semibold">
          {LIST_TITLE[listed.kind]}
        </p>
        {onAdd && (
          <button type="button" className="t-tap44 shrink-0 text-accent" onClick={onAdd}>
            Add
          </button>
        )}
        <button
          type="button"
          className="t-tap44 shrink-0 text-muted"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="h-5 w-5" strokeWidth={2.5} />
        </button>
      </div>

      <input
        ref={box}
        className="t-input mb-3"
        type="search"
        placeholder="Search"
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {dishes && (
        <div className="mb-3 flex justify-end gap-2">
          {(['list', 'grid'] as View[]).map((one) => (
            <button
              key={one}
              type="button"
              className="t-chip aria-pressed:border-accent aria-pressed:text-text"
              aria-pressed={view === one}
              onClick={() => choose(one)}
            >
              {one === 'list' ? 'List' : 'Grid'}
            </button>
          ))}
        </div>
      )}

      {listed.kind === 'foods' && (
        <div className="t-strip mb-3">
          {CHIPS.map((one) => (
            <button
              key={one.key}
              type="button"
              className="t-chip shrink-0 aria-pressed:border-accent aria-pressed:text-text"
              aria-pressed={chip === one.key}
              onClick={() => setChip(one.key)}
            >
              {one.label}
            </button>
          ))}
        </div>
      )}

      {/* Two columns where there is room for two, because a catalog somebody
          is looking a name up in reads across as well as down. */}
      <div
        className={
          dishes && view === 'grid'
            ? 't-card mb-3 grid grid-cols-2 gap-3 min-[640px]:grid-cols-3'
            : 't-card mb-3 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-x-6'
        }
      >
        {drawn.length === 0 ? (
          <p className="text-sm text-muted">{nothing}</p>
        ) : dishes && view === 'grid' ? (
          (drawn as (MealRow | RecipeRow)[]).map((row) => (
            <DishCell
              key={row.id}
              kind={listed.kind === 'meals' ? 'meal' : 'recipe'}
              name={row.name}
              under={
                'items' in row
                  ? row.items === 1
                    ? '1 food'
                    : `${row.items} foods`
                  : `Makes ${servingsText(row.yield_servings)}`
              }
              url={row.thumb_url ?? row.photo_url}
              onOpen={() => onOpen(row.id)}
            />
          ))
        ) : foodish ? (
          (drawn as FoodRow[]).map((row) => (
            <FoodLine
              key={row.id}
              row={row}
              onOpen={() => onOpen(row.id)}
              // Nothing comes off Recently used: it is what was eaten. A
              // favorite is unstarred wherever it is read.
              onRemove={onRemove === undefined ? undefined : () => onRemove(row)}
            />
          ))
        ) : listed.kind === 'meals' ? (
          (drawn as MealRow[]).map((row) => (
            <MealLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))
        ) : (
          (drawn as RecipeRow[]).map((row) => (
            <RecipeLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))
        )}
      </div>

      {shown.length > page && (
        <button
          type="button"
          className="t-btn mb-3 w-full"
          onClick={() => setPage(page + PAGE)}
        >
          Show more
        </button>
      )}
    </>
  )
}
