import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { FoodRow, MealRow, MyFoodRow, RecipeRow, RepeatRow } from '../api'
import { FoodLine, MealLine, RecipeLine } from '../components/FoodRows'

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
      <div className="t-card mb-3 min-[900px]:grid min-[900px]:grid-cols-2 min-[900px]:gap-x-6">
        {drawn.length === 0 ? (
          <p className="text-sm text-muted">{nothing}</p>
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
