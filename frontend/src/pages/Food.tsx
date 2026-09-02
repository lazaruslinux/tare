import {
  CookingPot,
  Pin,
  Plus,
  Repeat,
  Sandwich,
  ScanBarcode,
  ScanLine,
  Send,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  api,
  errorText,
  type Community,
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
type Undo = { message: string; commit: () => void; revert?: () => void }

// Where a food stands with the shared database, as one dot before its name.
// A word for each of these on every row would be a column of shouting; the
// colour carries it and the label is there for anybody reading with their ears.
const DOTS: Record<Community, { label: string; look: string }> = {
  none: { label: 'Not submitted', look: 'border border-line-strong' },
  pending: { label: 'Waiting for review', look: 'bg-pending' },
  approved: { label: 'Approved', look: 'bg-accent' },
  rejected: { label: 'Not approved', look: 'bg-danger' },
}

function Dot({ state }: { state: Community }) {
  const dot = DOTS[state]
  return (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${dot.look}`}
      role="img"
      aria-label={dot.label}
    />
  )
}

function Row({ row, onOpen }: { row: FoodRow; onOpen: () => void }) {
  return (
    <button type="button" className="t-row w-full text-left" onClick={onOpen}>
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

  // The list is the tab's root, and its header carries the way to a new food.
  // Every other view names itself, so the bar is left to whichever of them is
  // on.
  useTopBar(
    view.at === 'list'
      ? {
          title: 'Food',
          left: 'title',
          action: { label: 'New food', onAct: () => setView({ at: 'form', food: null }) },
        }
      : null
  )

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

  // A second deletion inside the window settles the first rather than
  // replacing it, so nothing leaves the screen without reaching the server.
  const hold = (waiting: Undo) => {
    settle()
    undoRef.current = waiting
    setUndo(waiting)
  }

  const loadRepeat = () => api<RepeatRow[]>('/foods/repeat').then(setRepeat, () => {})

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
    hold(waiting)
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
    hold(waiting)
  }

  // Off the list at once; pinned rows unpin, the rest are kept off for good.
  const removeRepeat = (row: RepeatRow) => {
    setRepeat((rows) => rows.filter((item) => item.id !== row.id))
    hold({
      message: row.pinned ? `Unpinned ${row.name}.` : `Took ${row.name} off Repeat.`,
      commit: () => {
        api(`/foods/${row.id}/${row.pinned ? 'pin' : 'repeat'}`, { method: 'DELETE' }).catch(() => {})
      },
      revert: () => void loadRepeat(),
    })
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
    hold(waiting)
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
    hold(waiting)
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
    const waiting = undoRef.current
    undoRef.current = null
    setUndo(null)
    waiting?.revert?.()
    void load()
    void loadSubmissions()
    void loadRecipes()
    void loadMeals()
    void loadRepeat()
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
        backLabel={from === 'browse' ? 'Browse tare database' : 'Food'}
        onBack={() => setView(from === 'browse' ? { at: 'browse' } : { at: 'list' })}
        onEdit={(food, notice) => setView({ at: 'form', food, notice })}
        onDelete={remove}
        onSubmitted={() => {
          void load()
          void loadSubmissions()
        }}
        onChanged={() => void loadRepeat()}
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
        onOpenFood={(id) => setView({ at: 'detail', id, from: 'list' })}
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
      {error && <p className="t-error mb-3">{error}</p>}

      {/* The empty state below carries its own way in, so this is only here
          once there is a list for it to sit above. */}
      {foods.length > 0 && (
        <button type="button" className="t-btn t-btn-primary mb-3 w-full" onClick={onScan}>
          <ScanLine className="h-4 w-4" strokeWidth={2} />
          Scan a barcode
        </button>
      )}

      <div className="t-card mb-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="t-section">
            <ScanBarcode className="h-4 w-4" strokeWidth={2} />
            Scanned / created foods
          </p>
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
          <>
            <p className="text-sm text-muted">
              Start here: scan a barcode or create a food, then submit it to add it to the
              tare database for everyone.
            </p>
            <div className="t-actions mt-3">
              <button type="button" className="t-btn t-btn-primary flex-1" onClick={onScan}>
                Scan a barcode
              </button>
              <button
                type="button"
                className="t-btn"
                onClick={() => setView({ at: 'form', food: null })}
              >
                Create a food
              </button>
            </div>
          </>
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
          <p className="t-section">
            <Sandwich className="h-4 w-4" strokeWidth={2} />
            Meals
          </p>
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
          <>
            <p className="text-sm text-muted">
              Meals log several foods in one line, like bread, cheese, mayo, lettuce, tomato
              and turkey as one Turkey sandwich.
            </p>
            <button
              type="button"
              className="t-btn mt-3"
              onClick={() => setView({ at: 'mealForm', meal: null })}
            >
              New meal
            </button>
          </>
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
          <p className="t-section">
            <CookingPot className="h-4 w-4" strokeWidth={2} />
            Recipes
          </p>
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
          <>
            <p className="text-sm text-muted">
              Recipes are for things you cook in a batch, like a pot of chili, with the
              numbers worked out per serving.
            </p>
            <button
              type="button"
              className="t-btn mt-3"
              onClick={() => setView({ at: 'recipeForm', recipe: null })}
            >
              New recipe
            </button>
          </>
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
        <p className="t-section mb-1">
          <Repeat className="h-4 w-4" strokeWidth={2} />
          Repeat items
        </p>
        {repeat.length === 0 ? (
          <p className="text-sm text-muted">
            The foods you pin and the ones you log will be offered here.
          </p>
        ) : (
          repeat.map((row) => (
            <div key={row.id} className="t-row">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
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
              <button
                type="button"
                className="t-tap44 shrink-0 text-muted"
                aria-label={row.pinned ? `Unpin ${row.name}` : `Take ${row.name} off Repeat`}
                onClick={() => removeRepeat(row)}
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="t-card mb-3" ref={submittedRef}>
        <p className="t-section mb-1">
          <Send className="h-4 w-4" strokeWidth={2} />
          Submitted
        </p>
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
        <p className="t-section">Browse tare database</p>
      </button>

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
