import { Pin, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  api,
  errorText,
  type Food as FoodItem,
  type FoodRow,
  type Meal,
  type MealRow,
  type Me,
  type MySubmission,
  type Recipe,
  type RecipeRow,
  type RepeatRow,
} from '../api'
import { FoodForm } from '../components/FoodForm'
import { PortionSheet } from '../components/PortionSheet'
import { nutrientText } from '../components/NutritionLabel'
import { useTopBar } from '../hooks/useTopBar'
import { slotByTime, today } from '../lib/day'
import { servingsText } from '../lib/units'
import { Browse } from './Browse'
import { FoodDetail } from './FoodDetail'
import { MealDetail } from './MealDetail'
import { PartsForm } from './PartsForm'
import { RecipeDetail } from './RecipeDetail'
import { KIND_LABEL } from '../lib/community'

// How many of your own foods the card shows before it offers the rest.
const SHOWN = 6
// Long enough that typing a word is one request rather than five.
const DEBOUNCE = 250
// How long something taken back can be put back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

const STATUS_LABEL: Record<MySubmission['status'], string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Not approved',
}

// What each kind of request is called where somebody reads their own list of
// them, in the words they would use rather than the words the column stores.
type View =
  | { at: 'list' }
  | { at: 'browse' }
  // Where going back from a food lands, because it is opened from two places.
  | { at: 'detail'; id: number; from: 'list' | 'browse' }
  | { at: 'form'; food: FoodItem | null; notice?: string }
  | { at: 'recipe'; id: number }
  | { at: 'meal'; id: number }
  // The editors are given what they are changing, or nothing for a new one.
  | { at: 'recipeForm'; recipe: Recipe | null }
  | { at: 'mealForm'; meal: Meal | null }

// Something taken off the screen that has not been sent yet. The request goes
// when the window closes, so undoing is not a second write to put back what a
// first one destroyed.
type Undo = { message: string; commit: () => void }

function Row({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm">{row.name}</span>
          {row.status === 'pending' && <span className="t-chip shrink-0">pending</span>}
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

export function FoodTab({
  me,
  start,
  onStarted,
  onScan,
}: {
  me: Me
  // Which card to open on, when something outside sent somebody here.
  start: 'list' | 'submissions'
  onStarted: () => void
  // The scanner, which lives above this tab because the centre control opens
  // it too. Offered here where an empty shared database is the thing on screen.
  onScan: () => void
}) {
  const [view, setView] = useState<View>({ at: 'list' })
  const [foods, setFoods] = useState<FoodRow[]>([])
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [repeat, setRepeat] = useState<RepeatRow[]>([])
  // The food a repeat row is being logged at, which is the picker's own sheet.
  const [logging, setLogging] = useState<FoodItem | null>(null)
  const [submissions, setSubmissions] = useState<MySubmission[]>([])
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  // Null is not an empty result: it is a box nobody has typed two letters into.
  const [results, setResults] = useState<FoodRow[] | null>(null)
  const [again, setAgain] = useState(0)

  // The list is the tab's root. Every other view names itself, so the bar is
  // left to whichever of them is on.
  useTopBar(view.at === 'list' ? { title: 'Food' } : null)

  const [undo, setUndo] = useState<Undo | null>(null)
  const undoRef = useRef<Undo | null>(null)
  const submittedRef = useRef<HTMLDivElement>(null)

  const load = () =>
    api<FoodRow[]>('/foods/mine').then(setFoods, (failure) => setError(errorText(failure)))

  const loadSubmissions = () =>
    api<MySubmission[]>('/submissions/mine').then(setSubmissions, () => setSubmissions([]))

  const loadRecipes = () => api<RecipeRow[]>('/recipes').then(setRecipes, () => setRecipes([]))

  const loadMeals = () => api<MealRow[]>('/meals').then(setMeals, () => setMeals([]))

  const settle = () => {
    const waiting = undoRef.current
    undoRef.current = null
    waiting?.commit()
  }

  useEffect(() => {
    let alive = true
    api<FoodRow[]>('/foods/mine')
      .then((rows) => alive && setFoods(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    api<MySubmission[]>('/submissions/mine')
      .then((rows) => alive && setSubmissions(rows))
      .catch(() => {})
    api<RecipeRow[]>('/recipes')
      .then((rows) => alive && setRecipes(rows))
      .catch(() => {})
    api<MealRow[]>('/meals')
      .then((rows) => alive && setMeals(rows))
      .catch(() => {})
    api<RepeatRow[]>('/foods/repeat')
      .then((rows) => alive && setRepeat(rows))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < 2) {
      setResults(null)
      return
    }
    const timer = window.setTimeout(() => {
      api<FoodRow[]>(`/foods/search?q=${encodeURIComponent(needle)}`)
        .then(setResults)
        .catch(() => setResults([]))
    }, DEBOUNCE)
    return () => window.clearTimeout(timer)
  }, [query, again])

  useEffect(() => {
    if (undo === null) return
    const timer = window.setTimeout(() => {
      settle()
      setUndo(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [undo])

  // Leaving the tab is the window closing. Anything still waiting is settled on
  // the way out rather than quietly forgotten.
  useEffect(() => () => settle(), [])

  useEffect(() => {
    if (start !== 'submissions') return
    submittedRef.current?.scrollIntoView({ block: 'start' })
    onStarted()
  }, [start, onStarted])

  const remove = (food: FoodItem) => {
    setFoods((rows) => rows.filter((row) => row.id !== food.id))
    setResults((rows) => (rows === null ? null : rows.filter((row) => row.id !== food.id)))
    setView({ at: 'list' })
    const waiting: Undo = {
      message: `Deleted ${food.name}.`,
      commit: () => {
        api(`/foods/${food.id}`, { method: 'DELETE' }).catch(() => {
          // The row is already off the screen. Saying so now, on a screen
          // somebody has moved on from, would be noise; the list tells the
          // truth the next time it is read.
        })
      },
    }
    undoRef.current = waiting
    setUndo(waiting)
  }

  const withdraw = (submission: MySubmission) => {
    setSubmissions((rows) => rows.filter((row) => row.id !== submission.id))
    const waiting: Undo = {
      message: `Took back ${submission.name ?? 'that submission'}.`,
      commit: () => {
        api(`/submissions/${submission.id}`, { method: 'DELETE' })
          .then(() => {
            void load()
          })
          .catch(() => {})
      },
    }
    undoRef.current = waiting
    setUndo(waiting)
  }

  const removeRecipe = (recipe: Recipe) => {
    setRecipes((rows) => rows.filter((row) => row.id !== recipe.id))
    setView({ at: 'list' })
    const waiting: Undo = {
      message: `Deleted ${recipe.name}.`,
      commit: () => {
        api(`/recipes/${recipe.id}`, { method: 'DELETE' }).catch(() => {})
      },
    }
    undoRef.current = waiting
    setUndo(waiting)
  }

  const removeMeal = (meal: Meal) => {
    setMeals((rows) => rows.filter((row) => row.id !== meal.id))
    setView({ at: 'list' })
    const waiting: Undo = {
      message: `Deleted ${meal.name}.`,
      commit: () => {
        api(`/meals/${meal.id}`, { method: 'DELETE' }).catch(() => {})
      },
    }
    undoRef.current = waiting
    setUndo(waiting)
  }

  // A repeat row is logged the way the picker logs one, at the portion sheet.
  const openRepeat = async (id: number) => {
    setError('')
    try {
      setLogging(await api<FoodItem>(`/foods/${id}`))
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  const putBack = () => {
    undoRef.current = null
    setUndo(null)
    void load()
    void loadSubmissions()
    void loadRecipes()
    void loadMeals()
    setAgain(again + 1)
  }

  if (view.at === 'browse') {
    return (
      <Browse
        onBack={() => setView({ at: 'list' })}
        onOpen={(id) => setView({ at: 'detail', id, from: 'browse' })}
        onScan={onScan}
      />
    )
  }

  if (view.at === 'detail') {
    const from = view.from
    return (
      <FoodDetail
        id={view.id}
        me={me}
        backLabel={from === 'browse' ? 'Browse database' : 'Food'}
        onBack={() => setView(from === 'browse' ? { at: 'browse' } : { at: 'list' })}
        onEdit={(food, notice) => setView({ at: 'form', food, notice })}
        onDelete={remove}
        onSubmitted={() => {
          void load()
          void loadSubmissions()
        }}
      />
    )
  }

  if (view.at === 'recipe') {
    return (
      <RecipeDetail
        id={view.id}
        me={me}
        onBack={() => setView({ at: 'list' })}
        onEdit={(recipe) => setView({ at: 'recipeForm', recipe })}
        onDelete={removeRecipe}
      />
    )
  }

  if (view.at === 'meal') {
    return (
      <MealDetail
        id={view.id}
        me={me}
        onBack={() => setView({ at: 'list' })}
        onEdit={(meal) => setView({ at: 'mealForm', meal })}
        onDelete={removeMeal}
      />
    )
  }

  if (view.at === 'recipeForm') {
    const editing = view.recipe
    return (
      <PartsForm
        kind="recipe"
        me={me}
        recipe={editing}
        onSaved={(id) => {
          void loadRecipes()
          setView({ at: 'recipe', id })
        }}
        onCancel={() =>
          setView(editing === null ? { at: 'list' } : { at: 'recipe', id: editing.id })
        }
      />
    )
  }

  if (view.at === 'mealForm') {
    const editing = view.meal
    return (
      <PartsForm
        kind="meal"
        me={me}
        meal={editing}
        onSaved={(id) => {
          void loadMeals()
          setView({ at: 'meal', id })
        }}
        onCancel={() =>
          setView(editing === null ? { at: 'list' } : { at: 'meal', id: editing.id })
        }
      />
    )
  }

  if (view.at === 'form') {
    const editing = view.food
    return (
      <FoodForm
        food={editing}
        notice={view.notice}
        backLabel={editing === null ? 'Food' : editing.name}
        onSaved={(saved) => {
          void load()
          setView({ at: 'detail', id: saved.id, from: 'list' })
        }}
        onCancel={() =>
          setView(
            editing === null ? { at: 'list' } : { at: 'detail', id: editing.id, from: 'list' }
          )
        }
      />
    )
  }

  return (
    <>

      {foods.length > 0 && (
        <input
          className="t-input mb-3"
          type="search"
          placeholder="Search foods"
          aria-label="Search foods"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}

      {error && <p className="t-error mb-3">{error}</p>}

      {results !== null ? (
        <div className="t-card mb-3">
          <p className="t-micro mb-1">Results</p>
          {results.length === 0 ? (
            <p className="text-sm text-muted">Nothing here goes by that name.</p>
          ) : (
            results.map((row) => (
              <Row
                key={row.id}
                row={row}
                onOpen={() => setView({ at: 'detail', id: row.id, from: 'list' })}
              />
            ))
          )}
        </div>
      ) : (
        <>
          <div className="t-card mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="t-micro">Custom Foods</p>
              <button
                type="button"
                className="t-tap44 text-accent"
                aria-label="Add a food"
                onClick={() => setView({ at: 'form', food: null })}
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {foods.length === 0 ? (
              <p className="text-sm text-muted">Foods you enter yourself are kept here.</p>
            ) : (
              <>
                {(expanded ? foods : foods.slice(0, SHOWN)).map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    onOpen={() => setView({ at: 'detail', id: row.id, from: 'list' })}
                  />
                ))}
                {foods.length > SHOWN && (
                  <button
                    type="button"
                    className="t-row w-full text-left text-sm text-muted"
                    onClick={() => setExpanded(!expanded)}
                  >
                    {expanded ? 'Show fewer' : `See all ${foods.length}`}
                  </button>
                )}
              </>
            )}
          </div>

          <div className="t-card mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="t-micro">Custom Meals</p>
              <button
                type="button"
                className="t-tap44 text-accent"
                aria-label="Add a meal"
                onClick={() => setView({ at: 'mealForm', meal: null })}
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {meals.length === 0 ? (
              <p className="text-sm text-muted">
                Foods you eat together go here, so you can log them in one tap.
              </p>
            ) : (
              meals.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => setView({ at: 'meal', id: row.id })}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {row.items === 1 ? '1 food' : `${row.items} foods`}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="t-card mb-3">
            <div className="mb-1 flex items-center justify-between">
              <p className="t-micro">Custom Recipes</p>
              <button
                type="button"
                className="t-tap44 text-accent"
                aria-label="Add a recipe"
                onClick={() => setView({ at: 'recipeForm', recipe: null })}
              >
                <Plus className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {recipes.length === 0 ? (
              <p className="text-sm text-muted">
                Things you cook go here, with the numbers worked out per serving.
              </p>
            ) : (
              recipes.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => setView({ at: 'recipe', id: row.id })}
                >
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
              ))
            )}
          </div>

          <div className="t-card mb-3">
            <p className="t-micro mb-1">Repeat Items</p>
            {repeat.length === 0 ? (
              <p className="text-sm text-muted">
                The foods you pin and the ones you log will be offered here.
              </p>
            ) : (
              repeat.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="t-row w-full text-left"
                  onClick={() => openRepeat(row.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {row.pinned && (
                        <Pin className="h-3 w-3 shrink-0 text-accent" strokeWidth={2.5} />
                      )}
                      <span className="truncate text-sm">{row.name}</span>
                    </span>
                    {row.brand && (
                      <span className="block truncate text-xs text-muted">{row.brand}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="t-nums block text-sm">
                      {nutrientText('calories', row.calories)} cal
                    </span>
                    <span className="block text-xs text-muted">per 100 {row.base_unit}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="t-card mb-3" ref={submittedRef}>
            <p className="t-micro mb-1">Submitted</p>
            {submissions.length === 0 ? (
              <p className="text-sm text-muted">
                Foods you offer to the shared database are tracked here.
              </p>
            ) : (
              submissions.map((row) => (
                <div key={row.id} className="t-row">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm">
                        {row.target_name ?? row.name ?? 'A deleted food'}
                      </span>
                      <span className="t-chip shrink-0">{STATUS_LABEL[row.status]}</span>
                    </span>
                    <span className="block text-xs text-muted">
                      {KIND_LABEL[row.kind] ?? row.kind}
                    </span>
                    {row.status === 'rejected' && row.decision_note && (
                      <span className="block text-xs text-muted">{row.decision_note}</span>
                    )}
                  </span>
                  {row.status === 'pending' && (
                    <button
                      type="button"
                      className="shrink-0 text-sm font-semibold text-muted"
                      onClick={() => withdraw(row)}
                    >
                      Withdraw
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className="t-card mb-3 w-full text-left"
            onClick={() => setView({ at: 'browse' })}
          >
            <p className="t-micro mb-1">Browse database</p>
            <p className="text-sm text-muted">Everything the instance has shared so far.</p>
          </button>
        </>
      )}

      {logging !== null && (
        <PortionSheet
          food={logging}
          date={today(me.timezone)}
          slot={slotByTime(me.timezone)}
          units={me.units}
          onClose={() => setLogging(null)}
          onDone={() => setLogging(null)}
        />
      )}

      {undo !== null && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-30 px-4">
          <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
            <span className="min-w-0 truncate">{undo.message}</span>
            <button type="button" className="font-semibold text-accent" onClick={putBack}>
              Undo
            </button>
          </div>
        </div>
      )}
    </>
  )
}
