import {
  ChevronDown,
  ChevronRight,
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
  foodPhoto,
  type Food as FoodItem,
  type Meal,
  type MealRow,
  type Me,
  type MyFoodRow,
  type MySubmission,
  type Recipe,
  type RecipeRow,
  type RepeatRow,
} from '../api'
import { FoodForm } from '../components/FoodForm'
import { Calories, FoodLine, MealLine, RecipeLine, subline } from '../components/FoodRows'
import { PortionSheet } from '../components/PortionSheet'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, slotByTime, today, dayOf } from '../lib/day'
import { Browse } from './Browse'
import { FoodDetail } from './FoodDetail'
import { MealDetail } from './MealDetail'
import { MyList, LIST_TITLE, type ListKind } from './MyList'
import { PartsForm } from './PartsForm'
import { RecipeDetail } from './RecipeDetail'
import { KIND_LABEL, changeLine, statusLabel } from '../lib/community'

// How many rows a card on this page shows before it stops being a card and
// starts being a list. Five is what fits above the fold beside four other
// cards; the rest are one tap away on a screen built to search them.
const SHOWN = 5
// Submissions are fewer and older ones are history, so that card shows three
// and folds the rest away in place rather than sending anybody to a screen.
const SENT_SHOWN = 3
// How long something taken back can be put back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

// Where going back from something lands, because a food is opened from the
// page, from the shared database and from a list screen alike.
type From = { at: 'list' } | { at: 'browse' } | { at: 'all'; kind: ListKind }

type View =
  | From
  | { at: 'detail'; id: number; from: From }
  // A food open in the form, and whether it was opened to be sent: Resubmit
  // is the edit form with the switch already on.
  | { at: 'form'; food: FoodItem | null; notice?: string; submitDefault?: boolean }
  | { at: 'recipe'; id: number; from: From }
  | { at: 'meal'; id: number; from: From }
  // The editors are given what they are changing, or nothing for a new one.
  | { at: 'recipeForm'; recipe: Recipe | null }
  | { at: 'mealForm'; meal: Meal | null }

// Something taken off the screen that has not been sent yet. The request goes
// when the window closes, so undoing is not a second write to put back what a
// first one destroyed.
type Undo = { message: string; commit: () => void; revert?: () => void }

// The way out of a card that holds more than it shows.
function SeeAll({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="t-row w-full text-left text-sm text-muted"
      onClick={onOpen}
    >
      <span className="flex-1">See all {count}</span>
      <ChevronRight className="h-4 w-4 shrink-0" strokeWidth={2.5} />
    </button>
  )
}

export function FoodTab({
  me,
  start,
  refresh,
  onStarted,
  onScan,
  onSeen,
  onChanged,
}: {
  me: Me
  // Which card to open on, when something outside sent somebody here.
  start: 'list' | 'submissions'
  // The app-wide change tick. Every bump reads the five lists again, quietly:
  // nothing is cleared first, so a tick nobody caused is a tick nobody sees.
  refresh: number
  onStarted: () => void
  // The scanner, which lives above this tab because the centre control opens
  // it too. Offered here where an empty shared database is the thing on screen.
  onScan: () => void
  // The answers on this screen have been read, so the badge that counted them
  // is worth asking again.
  onSeen: () => void
  // Something here changed on the server, and the other tabs list it too.
  onChanged: () => void
}) {
  const [view, setView] = useState<View>({ at: 'list' })
  const [foods, setFoods] = useState<MyFoodRow[]>([])
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [repeat, setRepeat] = useState<RepeatRow[]>([])
  // The food a repeat row is being logged at, which is the picker's own sheet.
  const [logging, setLogging] = useState<FoodItem | null>(null)
  const [submissions, setSubmissions] = useState<MySubmission[]>([])
  // Whether the older submissions are unfolded. Collapsed on every visit: the
  // three newest are what somebody came back to check.
  const [allSent, setAllSent] = useState(false)
  const [error, setError] = useState('')

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
    api<MyFoodRow[]>('/foods/mine').then(setFoods, (failure) => setError(errorText(failure)))

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
    api<MyFoodRow[]>('/foods/mine')
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
  }, [refresh])

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

  // The card is on this screen, so a decision listed on it has been seen. Once
  // per set of unread ones, and the badge is asked again after.
  const unread = submissions.some((row) => row.status !== 'pending' && row.seen_at === null)
  useEffect(() => {
    if (!unread) return
    api('/submissions/seen', { method: 'POST' })
      .then(() => {
        onSeen()
        return api<MySubmission[]>('/submissions/mine')
      })
      .then(setSubmissions)
      .catch(() => {})
  }, [unread, onSeen])

  // Newest first, sorted here rather than trusted to whichever request last
  // filled the list. The card shows the top of it and folds the rest away.
  const sent = [...submissions].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const older = Math.max(sent.length - SENT_SHOWN, 0)
  const shownSent = allSent ? sent : sent.slice(0, SENT_SHOWN)

  const remove = (food: FoodItem) => {
    setFoods((rows) => rows.filter((row) => row.id !== food.id))
    setView({ at: 'list' })
    const waiting: Undo = {
      message: `Deleted ${food.name}.`,
      commit: () => {
        api(`/foods/${food.id}`, { method: 'DELETE' }).then(onChanged, () => {
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
            onChanged()
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
        api(`/foods/${row.id}/${row.pinned ? 'pin' : 'repeat'}`, { method: 'DELETE' }).then(
          onChanged,
          () => {}
        )
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
        api(`/recipes/${recipe.id}`, { method: 'DELETE' }).then(onChanged, () => {})
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
        api(`/meals/${meal.id}`, { method: 'DELETE' }).then(onChanged, () => {})
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

  // What the screen behind a detail is called, for the control that goes back
  // to it.
  const nameOf = (from: From) =>
    from.at === 'browse'
      ? 'Browse Tare database'
      : from.at === 'all'
        ? LIST_TITLE[from.kind]
        : 'Food'

  if (view.at === 'all') {
    const kind = view.kind
    const back = () => setView({ at: 'list' })
    return (
      <MyList
        listed={
          kind === 'foods'
            ? { kind, rows: foods }
            : kind === 'meals'
              ? { kind, rows: meals }
              : { kind, rows: recipes }
        }
        onBack={back}
        onOpen={(id) =>
          setView(
            kind === 'foods'
              ? { at: 'detail', id, from: { at: 'all', kind } }
              : kind === 'meals'
                ? { at: 'meal', id, from: { at: 'all', kind } }
                : { at: 'recipe', id, from: { at: 'all', kind } }
          )
        }
        onAdd={() =>
          setView(
            kind === 'foods'
              ? { at: 'form', food: null }
              : kind === 'meals'
                ? { at: 'mealForm', meal: null }
                : { at: 'recipeForm', recipe: null }
          )
        }
      />
    )
  }

  if (view.at === 'browse') {
    return (
      <Browse
        refresh={refresh}
        onBack={() => setView({ at: 'list' })}
        onOpen={(id) => setView({ at: 'detail', id, from: { at: 'browse' } })}
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
        backLabel={nameOf(from)}
        onBack={() => setView(from)}
        onEdit={(food, opened) => setView({ at: 'form', food, ...opened })}
        onDelete={remove}
        onSubmitted={() => {
          void load()
          void loadSubmissions()
          onChanged()
        }}
        onSeen={onSeen}
        onChanged={() => {
          void loadRepeat()
          onChanged()
        }}
      />
    )
  }

  if (view.at === 'recipe') {
    const from = view.from
    return (
      <RecipeDetail
        id={view.id}
        me={me}
        backLabel={nameOf(from)}
        onBack={() => setView(from)}
        onEdit={(recipe) => setView({ at: 'recipeForm', recipe })}
        onDelete={removeRecipe}
        onLogged={onChanged}
      />
    )
  }

  if (view.at === 'meal') {
    const from = view.from
    return (
      <MealDetail
        id={view.id}
        me={me}
        backLabel={nameOf(from)}
        onBack={() => setView(from)}
        onEdit={(meal) => setView({ at: 'mealForm', meal })}
        onDelete={removeMeal}
        onLogged={onChanged}
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
          onChanged()
          setView({ at: 'recipe', id, from: { at: 'list' } })
        }}
        onCancel={() =>
          setView(
            editing === null
              ? { at: 'list' }
              : { at: 'recipe', id: editing.id, from: { at: 'list' } }
          )
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
          onChanged()
          setView({ at: 'meal', id, from: { at: 'list' } })
        }}
        onCancel={() =>
          setView(
            editing === null
              ? { at: 'list' }
              : { at: 'meal', id: editing.id, from: { at: 'list' } }
          )
        }
      />
    )
  }

  if (view.at === 'form') {
    const editing = view.food
    // A shared food open in front of an administrator. Both its pictures are
    // theirs to replace or take off, which is the review queue's editor exactly.
    const correcting = me.is_admin && editing !== null && editing.status === 'approved'
    return (
      <FoodForm
        food={editing}
        notice={view.notice}
        submitDefault={view.submitDefault}
        title={correcting ? 'Edit this food' : undefined}
        review={
          correcting && editing !== null
            ? {
                frontPhotoUrl: editing.photo_url,
                labelPhotoUrl: editing.label_photo_url ?? null,
                onPhoto: (purpose, photoId) => foodPhoto(editing.id, purpose, photoId),
              }
            : undefined
        }
        backLabel={editing === null ? 'Food' : editing.name}
        onOpenFood={(id) => setView({ at: 'detail', id, from: { at: 'list' } })}
        onSaved={(saved) => {
          void load()
          void loadSubmissions()
          onChanged()
          setView({ at: 'detail', id: saved.id, from: { at: 'list' } })
        }}
        onCancel={() =>
          setView(
            editing === null
              ? { at: 'list' }
              : { at: 'detail', id: editing.id, from: { at: 'list' } }
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
              Tare database for everyone.
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
            {foods.slice(0, SHOWN).map((row) => (
              <FoodLine
                key={row.id}
                row={row}
                onOpen={() => setView({ at: 'detail', id: row.id, from: { at: 'list' } })}
              />
            ))}
            {foods.length > SHOWN && (
              <SeeAll
                count={foods.length}
                onOpen={() => setView({ at: 'all', kind: 'foods' })}
              />
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
              Meals turn several food items into one line. Example: cheese, bread, mayo,
              turkey = "Turkey Sandwich"
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
          <>
            {meals.slice(0, SHOWN).map((row) => (
              <MealLine
                key={row.id}
                row={row}
                onOpen={() => setView({ at: 'meal', id: row.id, from: { at: 'list' } })}
              />
            ))}
            {meals.length > SHOWN && (
              <SeeAll
                count={meals.length}
                onOpen={() => setView({ at: 'all', kind: 'meals' })}
              />
            )}
          </>
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
          <>
            {recipes.slice(0, SHOWN).map((row) => (
              <RecipeLine
                key={row.id}
                row={row}
                onOpen={() => setView({ at: 'recipe', id: row.id, from: { at: 'list' } })}
              />
            ))}
            {recipes.length > SHOWN && (
              <SeeAll
                count={recipes.length}
                onOpen={() => setView({ at: 'all', kind: 'recipes' })}
              />
            )}
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <p className="t-section mb-1">
          <Repeat className="h-4 w-4" strokeWidth={2} />
          Repeat items
        </p>
        {repeat.length === 0 ? (
          <p className="text-sm text-muted">
            The foods you pin and the ones you log will show up here.
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
                  {subline(row) && (
                    <span className="block truncate text-xs text-muted">{subline(row)}</span>
                  )}
                </span>
                <Calories row={row} />
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

      <div className="mb-3" ref={submittedRef}>
        <div className={`t-card${older > 0 ? ' t-card-tabbed' : ''}`}>
          <p className="t-section mb-1">
            <Send className="h-4 w-4" strokeWidth={2} />
            View submissions
          </p>
          {sent.length === 0 ? (
            <p className="text-sm text-muted">
              Foods you submit to the Tare database show up here.
            </p>
          ) : (
            shownSent.map((row) => {
              // The food this row is about: the one that was submitted, or the
              // shared one a correction or a picture is for. Gone with the food.
              const foodId = row.food_id
              const said = (
                <>
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm">
                      {row.target_name ?? row.name ?? 'A deleted food'}
                    </span>
                    <span className="t-chip shrink-0">
                      {statusLabel(row.status, row.edited, row.kind)}
                    </span>
                  </span>
                  <span className="block text-xs text-muted">
                    {KIND_LABEL[row.kind] ?? row.kind} ·{' '}
                    {dayLabel(dayOf(me.timezone, row.created_at), today(me.timezone))}
                  </span>
                  {row.changes.length > 0 && (
                    <span className="block text-xs text-muted">{changeLine(row.changes)}</span>
                  )}
                  {row.status === 'rejected' && row.decision_note && (
                    <span className="block text-xs text-muted">Reason: {row.decision_note}</span>
                  )}
                </>
              )
              return (
                <div key={row.id} className="t-row">
                  {foodId === null ? (
                    <span className="min-w-0 flex-1">{said}</span>
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        setView({ at: 'detail', id: foodId, from: { at: 'list' } })
                      }
                    >
                      {said}
                    </button>
                  )}
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
              )
            })
          )}
        </div>
        {older > 0 && (
          <button
            type="button"
            className="t-tab t-micro t-tap44 text-accent"
            aria-expanded={allSent}
            onClick={() => setAllSent(!allSent)}
          >
            {allSent ? 'Show fewer' : `Show ${older} more`}
            <ChevronDown
              className={`h-3.5 w-3.5 ${allSent ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
            />
          </button>
        )}
      </div>

      <button
        type="button"
        className="t-card mb-3 w-full text-left"
        onClick={() => setView({ at: 'browse' })}
      >
        <p className="t-section">Browse Tare database</p>
      </button>

      {logging !== null && (
        <PortionSheet
          food={logging}
          date={today(me.timezone)}
          slot={slotByTime(me.timezone)}
          units={me.units}
          onClose={() => setLogging(null)}
          onDone={() => {
            setLogging(null)
            void loadRepeat()
            onChanged()
          }}
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
