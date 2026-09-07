import {
  CalendarSync,
  ChevronRight,
  CookingPot,
  Plus,
  Sandwich,
  Library,
  ScanBarcode,
  Search,
  Star,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  api,
  errorText,
  foodPhoto,
  type AutoLog,
  type Food as FoodItem,
  type FoodRow,
  type Meal,
  type MealRow,
  type Me,
  type MyFoodRow,
  type Recipe,
  type RecipeRow,
  type RepeatRow,
} from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { FoodForm } from '../components/FoodForm'
import { FoodPicker } from '../components/FoodPicker'
import {
  DishThumb,
  FoodLine,
  KindMark,
  MealLine,
  RecipeLine,
  Thumb,
  favoritesOf,
} from '../components/FoodRows'
import { MemberView } from '../components/MemberView'
import { PortionSheet } from '../components/PortionSheet'
import { Sheet } from '../components/Sheet'
import { useTopBar } from '../hooks/useTopBar'
import { SLOTS, SLOT_LABEL, today } from '../lib/day'
import { reviews } from '../lib/roles'
import { gramsText, portionText, servingsText } from '../lib/units'
import { FoodDetail } from './FoodDetail'
import { MealDetail } from './MealDetail'
import { MyList, LIST_TITLE, type ListKind } from './MyList'
import { PartsForm } from './PartsForm'
import { RecipeDetail } from './RecipeDetail'

// How many rows a card on this page shows before it stops being a card and
// starts being a list. Three keeps all five cards in reach; the rest are one
// tap away in a catalog built to search them.
const SHOWN = 3

// How much of it goes in every day, in the words the diary row of that kind
// reads back in: a food is the portion it was measured out as, and a recipe or
// a meal is counted in servings of itself or taken off the scale.
function autoAmount(row: AutoLog): string {
  if (row.kind === 'food') return portionText(row)
  return row.unit === 'g' ? gramsText(row.amount) : servingsText(row.amount)
}

// The Auto-log card is a list of things, not a list of instructions: a food set
// for three mealtimes is one row that says three, in the order the day runs.
function autoGroups(rows: AutoLog[]): AutoLog[][] {
  const groups: AutoLog[][] = []
  const found = new Map<string, AutoLog[]>()
  for (const row of rows) {
    const key = `${row.kind}:${row.food_id ?? row.recipe_id ?? row.meal_id}`
    const group = found.get(key)
    if (group === undefined) {
      const started = [row]
      found.set(key, started)
      groups.push(started)
    } else {
      group.push(row)
    }
  }
  for (const group of groups) {
    group.sort((one, other) => SLOTS.indexOf(one.slot) - SLOTS.indexOf(other.slot))
  }
  return groups
}

// The mealtimes of a group as a sentence: "breakfast, lunch and dinner".
function mealtimeList(group: AutoLog[]): string {
  const names = group.map((row) => SLOT_LABEL[row.slot].toLowerCase())
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// Where going back from something lands. Everything on this tab is opened
// from the tab's own list, the catalogs and the search sheet included, so
// there is one answer.
type From = { at: 'list' }

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
  open,
  refresh,
  onOpened,
  onScan,
  onSeen,
  onChanged,
}: {
  me: Me
  // A food to open on, when something outside sent somebody here to see it.
  // Handed back the moment this tab has read it.
  open: number | null
  // The app-wide change tick. Every bump reads the four lists again, quietly:
  // nothing is cleared first, so a tick nobody caused is a tick nobody sees.
  refresh: number
  onOpened: () => void
  // The scanner, which lives above this tab because the centre control opens
  // it too. Offered here where an empty shared database is the thing on screen.
  onScan: () => void
  // The answers on a food page have been read, so the badge that counted them
  // is worth asking again.
  onSeen: () => void
  // Something here changed on the server, and the other tabs list it too.
  onChanged: () => void
}) {
  const [view, setView] = useState<View>({ at: 'list' })
  // Whose page is open over the food that named them, and what the way back
  // to that food is called.
  const [member, setMember] = useState<{ id: number; back: string } | null>(null)
  const [foods, setFoods] = useState<MyFoodRow[]>([])
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [meals, setMeals] = useState<MealRow[]>([])
  const [repeat, setRepeat] = useState<RepeatRow[]>([])
  const [autos, setAutos] = useState<AutoLog[]>([])
  // The standing auto-log open in the same sheet, with the food it is about.
  const [autoEdit, setAutoEdit] = useState<{ food: FoodItem; row: AutoLog } | null>(null)
  // The item being taken off Auto-log, every mealtime of it, while the question
  // about it is up.
  const [autoOff, setAutoOff] = useState<AutoLog[] | null>(null)
  const [autoOffBusy, setAutoOffBusy] = useState(false)
  // The shared database, open over the tab: a box to type in, and the whole
  // database to read under it until somebody does.
  const [searching, setSearching] = useState(false)
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

  // The favorite waiting on the question about taking its star off.
  const [unstarring, setUnstarring] = useState<FoodRow | null>(null)

  const load = () =>
    api<MyFoodRow[]>('/foods/mine').then(setFoods, (failure) => setError(errorText(failure)))

  const loadRecipes = () => api<RecipeRow[]>('/recipes').then(setRecipes, () => setRecipes([]))

  const loadMeals = () => api<MealRow[]>('/meals').then(setMeals, () => setMeals([]))

  const loadRepeat = () => api<RepeatRow[]>('/foods/repeat').then(setRepeat, () => {})

  const loadAutos = () => api<AutoLog[]>('/diary/auto-logs').then(setAutos, () => {})

  useEffect(() => {
    let alive = true
    api<MyFoodRow[]>('/foods/mine')
      .then((rows) => alive && setFoods(rows))
      .catch((failure) => alive && setError(errorText(failure)))
    api<RecipeRow[]>('/recipes')
      .then((rows) => alive && setRecipes(rows))
      .catch(() => {})
    api<MealRow[]>('/meals')
      .then((rows) => alive && setMeals(rows))
      .catch(() => {})
    api<RepeatRow[]>('/foods/repeat')
      .then((rows) => alive && setRepeat(rows))
      .catch(() => {})
    api<AutoLog[]>('/diary/auto-logs')
      .then((rows) => alive && setAutos(rows))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [refresh])

  // A food asked for from outside is opened once, and then this tab owns where
  // it is again.
  useEffect(() => {
    if (open === null) return
    setMember(null)
    setView({ at: 'detail', id: open, from: { at: 'list' } })
    onOpened()
  }, [open, onOpened])

  // A food gone for good, asked about on its own page first. The page waits
  // for the answer, so a refusal is read there and not on a list it left.
  const erase = (food: FoodItem, back: View) =>
    api(`/foods/${food.id}`, { method: 'DELETE' }).then(() => {
      setFoods((rows) => rows.filter((row) => row.id !== food.id))
      setView(back)
      void loadRepeat()
      onChanged()
    })

  // Off the card and off the server at once, once the question has been
  // answered.
  const removeFavorite = (row: FoodRow) => {
    setRepeat((rows) => rows.filter((item) => item.id !== row.id))
    api(`/foods/${row.id}/pin`, { method: 'DELETE' }).then(onChanged, () => {})
  }

  // Taking an item off the card takes off every mealtime it was set for, which
  // is one request each, and only after the question below has been answered.
  const removeAuto = async (group: AutoLog[]) => {
    setAutoOffBusy(true)
    setError('')
    try {
      for (const row of group) {
        await api(`/diary/auto-logs/${row.id}`, { method: 'DELETE' })
      }
    } catch (failure) {
      setError(errorText(failure))
    }
    setAutoOff(null)
    setAutoOffBusy(false)
    await loadAutos()
    onChanged()
  }

  // A list a card holds more of, open as a catalog over the tab. The tab stays
  // rendered underneath, so closing it has nothing to put back.
  const [catalog, setCatalog] = useState<ListKind | null>(null)

  // The sheet closes on Escape.
  useEffect(() => {
    if (catalog === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCatalog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [catalog])

  // Both pages ask before they call this, so the request goes at once.
  const removeRecipe = (recipe: Recipe) => {
    setRecipes((rows) => rows.filter((row) => row.id !== recipe.id))
    setView({ at: 'list' })
    api(`/recipes/${recipe.id}`, { method: 'DELETE' }).then(onChanged, () => {})
  }

  const removeMeal = (meal: Meal) => {
    setMeals((rows) => rows.filter((row) => row.id !== meal.id))
    setView({ at: 'list' })
    api(`/meals/${meal.id}`, { method: 'DELETE' }).then(onChanged, () => {})
  }

  // The same sheet the food page opens, on the food this instruction is about.
  // A recipe or a meal is set from its own page, so tapping one opens that.
  const openAuto = async (row: AutoLog) => {
    setError('')
    if (row.recipe_id !== null) {
      setView({ at: 'recipe', id: row.recipe_id, from: { at: 'list' } })
      return
    }
    if (row.meal_id !== null) {
      setView({ at: 'meal', id: row.meal_id, from: { at: 'list' } })
      return
    }
    try {
      setAutoEdit({ food: await api<FoodItem>(`/foods/${row.food_id}`), row })
    } catch (failure) {
      setError(errorText(failure))
    }
  }

  // The card and the catalog over it read the same starred foods, in the same
  // order.
  const favorites = favoritesOf(repeat)

  if (view.at === 'detail') {
    const from = view.from
    if (member !== null) {
      return (
        <MemberView
          userId={member.id}
          back={member.back}
          onBack={() => setMember(null)}
          onChange={onChanged}
        />
      )
    }
    return (
      <FoodDetail
        id={view.id}
        me={me}
        backLabel="Food"
        onBack={() => setView(from)}
        onEdit={(food, opened) => setView({ at: 'form', food, ...opened })}
        onDelete={(food) => erase(food, from)}
        onDeleteShared={(food) => erase(food, from)}
        onSubmitted={() => {
          void load()
          onChanged()
        }}
        onSeen={onSeen}
        onChanged={() => {
          void load()
          void loadRepeat()
          void loadAutos()
          onChanged()
        }}
        onOpenMember={(id, back) => setMember({ id, back })}
      />
    )
  }

  if (view.at === 'recipe') {
    const from = view.from
    return (
      <RecipeDetail
        id={view.id}
        me={me}
        backLabel="Food"
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
        backLabel="Food"
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
    const correcting = reviews(me) && editing !== null && editing.status === 'approved'
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
        // Somebody else saved this food while it was open. Read again, and the
        // form reopens on what it says now.
        onReload={
          editing === null
            ? undefined
            : () => {
                void api<FoodItem>(`/foods/${editing.id}`).then((fresh) =>
                  setView({ at: 'form', food: fresh })
                )
              }
        }
      />
    )
  }

  return (
    <>
      {error && <p className="t-error mb-3">{error}</p>}

      {/* The two ways into the shared database, on one line above everything
          this account keeps: type the name, or hold the packet up. The field is
          a button rather than a box, because what it opens is a sheet with a
          box of its own and the database underneath it. */}
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          className="t-input flex flex-1 items-center gap-2 text-left text-muted"
          onClick={() => setSearching(true)}
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={2} />
          <span className="truncate">Search items, like Great Value cheese</span>
        </button>
        <button
          type="button"
          className="t-btn t-tap44 w-11 shrink-0 px-0"
          aria-label="Scan a barcode"
          onClick={onScan}
        >
          <ScanBarcode className="h-5 w-5" strokeWidth={2} />
        </button>
      </div>

      <div className="t-card mb-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="t-section">
            <Library className="h-4 w-4" strokeWidth={2} />
            Recently used
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
              Nothing here yet. Scan a barcode or create a food to start.
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
                onOpen={() => setCatalog('foods')}
              />
            )}
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <p className="t-section mb-1">
          <Star className="h-4 w-4" strokeWidth={2} />
          Favorites
        </p>
        {favorites.length === 0 ? (
          <p className="text-sm text-muted">
            Items you add to favorites will show up here.
          </p>
        ) : (
          <>
            {favorites.slice(0, SHOWN).map((row) => (
              <FoodLine
                key={row.id}
                row={row}
                onOpen={() => setView({ at: 'detail', id: row.id, from: { at: 'list' } })}
                onRemove={() => setUnstarring(row)}
                removeLabel={`Remove ${row.name} from Favorites`}
              />
            ))}
            {favorites.length > SHOWN && (
              <SeeAll count={favorites.length} onOpen={() => setCatalog('favorites')} />
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
                onOpen={() => setCatalog('meals')}
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
                onOpen={() => setCatalog('recipes')}
              />
            )}
          </>
        )}
      </div>

      <div className="t-card mb-3">
        <p className="t-section mb-1">
          <CalendarSync className="h-4 w-4" strokeWidth={2} />
          Auto-log
        </p>
        {autos.length === 0 ? (
          <p className="text-sm text-muted">
            Setup Auto-Log on an item's details page.
          </p>
        ) : (
          autoGroups(autos).map((group) => {
            const row = group[0]
            return (
              <div key={row.id} className="t-row">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => openAuto(row)}
                >
                  {row.kind === 'food' ? (
                    <Thumb url={row.thumb_url} />
                  ) : (
                    <DishThumb kind={row.kind} url={row.thumb_url} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm">{row.name}</span>
                      {row.kind !== 'food' && <KindMark kind={row.kind} />}
                      {group.length > 1 && <span className="t-chip">x{group.length}</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {group.length === 1
                        ? `${autoAmount(row)} · ${SLOT_LABEL[row.slot]}`
                        : group
                            .map((one) => `${SLOT_LABEL[one.slot]} ${autoAmount(one)}`)
                            .join(' · ')}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="t-tap44 shrink-0 text-muted"
                  aria-label={`Take ${row.name} off Auto-log`}
                  onClick={() => setAutoOff(group)}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                </button>
              </div>
            )
          })
        )}
      </div>

      {searching && (
        <FoodPicker
          me={me}
          onClose={() => setSearching(false)}
          browse={{
            refresh,
            onScan,
            onOpen: (id) => {
              setSearching(false)
              setView({ at: 'detail', id, from: { at: 'list' } })
            },
          }}
        />
      )}

      {autoEdit !== null && (
        <PortionSheet
          food={autoEdit.food}
          date={today(me.timezone)}
          slot={autoEdit.row.slot}
          onClose={() => setAutoEdit(null)}
          onDone={() => setAutoEdit(null)}
          autoLog={{
            standing: autos.filter((row) => row.food_id === autoEdit.food.id),
            onSaved: () => {
              setAutoEdit(null)
              void loadAutos()
              onChanged()
            },
            onStopped: () => {
              setAutoEdit(null)
              void loadAutos()
              onChanged()
            },
          }}
        />
      )}

      <ConfirmSheet
        open={autoOff !== null}
        label="Take off Auto-log"
        question={autoOff === null ? '' : `Take ${autoOff[0].name} off Auto-log?`}
        note={autoOff === null ? undefined : `It logs itself at ${mealtimeList(autoOff)}.`}
        verb="Remove"
        busy={autoOffBusy}
        onConfirm={() => {
          if (autoOff !== null) void removeAuto(autoOff)
        }}
        onClose={() => setAutoOff(null)}
      />

      {catalog !== null && (
        <Sheet open wide label={LIST_TITLE[catalog]} onClose={() => setCatalog(null)}>
          <MyList
            listed={
              catalog === 'foods'
                ? { kind: catalog, rows: foods }
                : catalog === 'favorites'
                  ? { kind: catalog, rows: favorites }
                  : catalog === 'meals'
                    ? { kind: catalog, rows: meals }
                    : { kind: catalog, rows: recipes }
            }
            onClose={() => setCatalog(null)}
            // The question opens over the catalog, and the row leaves the
            // list behind it.
            onRemove={catalog === 'favorites' ? (row) => setUnstarring(row) : undefined}
            onOpen={(id) => {
              setCatalog(null)
              setView(
                catalog === 'foods' || catalog === 'favorites'
                  ? { at: 'detail', id, from: { at: 'list' } }
                  : catalog === 'meals'
                    ? { at: 'meal', id, from: { at: 'list' } }
                    : { at: 'recipe', id, from: { at: 'list' } }
              )
            }}
            // Nothing is added to Favorites from a list of them: a food is
            // starred on its own page.
            onAdd={
              catalog === 'favorites'
                ? undefined
                : () => {
                    setCatalog(null)
                    setView(
                      catalog === 'foods'
                        ? { at: 'form', food: null }
                        : catalog === 'meals'
                          ? { at: 'mealForm', meal: null }
                          : { at: 'recipeForm', recipe: null }
                    )
                  }
            }
          />
        </Sheet>
      )}

      {/* After the catalog, so the question is on top of it. */}
      <ConfirmSheet
        open={unstarring !== null}
        label="Remove from Favorites"
        question={unstarring === null ? '' : `Remove ${unstarring.name} from Favorites?`}
        note="You can add it back from its page."
        verb="Remove"
        onConfirm={() => {
          if (unstarring === null) return
          const row = unstarring
          setUnstarring(null)
          removeFavorite(row)
        }}
        onClose={() => setUnstarring(null)}
      />
    </>
  )
}
