import { useEffect, useRef, useState } from 'react'

import type { MealRow, MyFoodRow, RecipeRow } from '../api'
import { FoodLine, MealLine, RecipeLine } from '../components/FoodRows'
import { useTopBar } from '../hooks/useTopBar'

// Everything a member has of one kind, on a screen of its own. The Food page
// shows the few they are most likely to want; this is where the other three
// hundred live, and the only work it does is narrowing a list it was handed.
// Nothing here asks the server anything: the page above has already read the
// list, and a filter that goes back over the network is a filter that stutters.

export type ListKind = 'foods' | 'meals' | 'recipes'

export const LIST_TITLE: Record<ListKind, string> = {
  foods: 'My foods',
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

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

// Where the search box takes focus on its own. A phone would answer that with
// the keyboard over half the screen before anybody asked for it.
const ROOMY = '(min-width: 900px)'

// The rows, told apart by which list this is. One shape at a time on screen,
// so the kind decides the row and the filters alike.
export type Listed =
  | { kind: 'foods'; rows: MyFoodRow[] }
  | { kind: 'meals'; rows: MealRow[] }
  | { kind: 'recipes'; rows: RecipeRow[] }

function folded(text: string): string {
  return text.trim().toLowerCase()
}

export function MyList({
  listed,
  onBack,
  onOpen,
  onAdd,
}: {
  listed: Listed
  onBack: () => void
  onOpen: (id: number) => void
  // The same thing the card's plus does, in the bar of the screen that grew
  // out of that card.
  onAdd: () => void
}) {
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('')
  const [chip, setChip] = useState<Chip>('all')
  const box = useRef<HTMLInputElement>(null)

  useTopBar({
    title: LIST_TITLE[listed.kind],
    back: { label: 'Food', onBack },
    action: { label: 'Add', onAct: onAdd },
  })

  useEffect(() => {
    if (window.matchMedia(ROOMY).matches) box.current?.focus()
  }, [])

  const needle = folded(query)
  // Alphabetical whatever order the list arrived in. The page above leads with
  // what was eaten last, which is the right answer for five rows and the wrong
  // one for three hundred: a long list is read by looking something up.
  const rows = [...listed.rows].sort((one, two) =>
    folded(one.name).localeCompare(folded(two.name))
  )

  const shown = rows.filter((row) => {
    const name = folded(row.name)
    // Only a food has a brand and a description, and a search reads both as
    // part of the name.
    const about =
      listed.kind === 'foods'
        ? folded(`${(row as MyFoodRow).brand} ${(row as MyFoodRow).description}`)
        : ''
    if (needle && !name.includes(needle) && !about.includes(needle)) return false
    if (letter && !name.startsWith(letter.toLowerCase())) return false
    if (listed.kind === 'foods' && chip !== 'all') {
      return (row as MyFoodRow).community === chip
    }
    return true
  })

  // Why the screen is empty, in the words of whichever filter emptied it. The
  // one somebody just touched is the one they want answered.
  const nothing = needle
    ? 'Nothing here goes by that name.'
    : letter
      ? `Nothing starts with ${letter}.`
      : (CHIPS.find((one) => one.key === chip)?.empty ?? 'Nothing here yet.')

  return (
    <>
      <input
        ref={box}
        className="t-input mb-3"
        type="search"
        placeholder="Search"
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="mb-3 flex gap-x-2 gap-y-4 overflow-x-auto min-[900px]:flex-wrap">
        {LETTERS.map((option) => (
          <button
            key={option}
            type="button"
            className="t-chip t-tap44 min-w-9 shrink-0 justify-center aria-pressed:border-accent aria-pressed:text-text"
            aria-pressed={letter === option}
            onClick={() => setLetter(letter === option ? '' : option)}
          >
            {option}
          </button>
        ))}
      </div>

      {listed.kind === 'foods' && (
        <div className="mb-3 flex gap-x-2 gap-y-4 overflow-x-auto min-[900px]:flex-wrap">
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

      <div className="t-card mb-3">
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{nothing}</p>
        ) : listed.kind === 'foods' ? (
          (shown as MyFoodRow[]).map((row) => (
            <FoodLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))
        ) : listed.kind === 'meals' ? (
          (shown as MealRow[]).map((row) => (
            <MealLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))
        ) : (
          (shown as RecipeRow[]).map((row) => (
            <RecipeLine key={row.id} row={row} onOpen={() => onOpen(row.id)} />
          ))
        )}
      </div>
    </>
  )
}
