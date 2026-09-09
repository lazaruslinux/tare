import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'

import { api, errorText, type Me, type WorkoutDetail, type WorkoutSplit } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { basemapInstalled, canDrawMaps } from '../lib/basemap'
import { dayLabel, today } from '../lib/day'
import { placesOf, spansOf } from '../lib/route'
import {
  distanceIn,
  distanceText,
  distanceUnit,
  durationText,
  paceFromUnit,
  paceText,
} from '../lib/units'
import { ActivityIcon } from './ActivityIcon'
import { LaneGraph } from './LaneGraph'
import { RouteLine, type RouteMarker } from './RouteLine'
import { Switch } from './Switch'

// The map and everything under it, fetched only where the instance has the
// basemap installed. An instance without it never asks for this chunk.
const RouteMap = lazy(() => import('./RouteMap'))

// The renderer can still throw on a machine that said it could draw. Rather
// than let the root boundary blank the app over one card, this catches it and
// puts the drawn line back in its place.
class MapGuard extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// What another member's sharing left out is absent from the answer, so
// everything drawn from one is asked whether it is there at all.
const present = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined

// The floor a split's bar never goes under, so the slowest split of a session
// still reads as a bar rather than as nothing at all.
const SPLIT_FLOOR = 30

// Where one split sits in the range this session actually ran: the quickest
// fills its row, the slowest keeps the floor, and everything between is spread
// evenly across the gap. Measuring every bar against the quickest alone made a
// steady session read as identical full bars, because five miles within four
// seconds of each other are almost exactly one another. A session with one
// split, or with every split inside a second of the rest, has no range to
// spread over and every bar is full.
function splitShare(pace: number, fastest: number, slowest: number): number {
  if (!(pace > 0) || !(slowest - fastest >= 1)) return 100
  return 100 - (100 - SPLIT_FLOOR) * ((pace - fastest) / (slowest - fastest))
}

// The words for what looked odd about a session. A flag is never a refusal:
// the workout is here, and this is Tare saying it does not quite believe one
// of the numbers on it.
const FLAG_TEXT: Record<string, string> = {
  impossible_pace: 'This one is faster than Tare expected. The numbers are as your phone sent them.',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="t-micro mb-0.5">{label}</p>
      <p className="t-nums text-lg">{value}</p>
    </div>
  )
}

// The fastest split said in words, under the list that marks it in colour.
function fastestLine(split: WorkoutSplit, units: 'imperial' | 'metric'): string {
  const said = paceFromUnit(split.pace_s_per_unit, units).split(' ')[0]
  const word = units === 'metric' ? 'kilometer' : 'mile'
  return `Fastest ${word}: ${said} (${word} ${split.index})`
}

function Splits({
  splits,
  fastest: named,
  units,
  chosen,
  lined,
  onChoose,
}: {
  splits: WorkoutSplit[]
  // Which split the server called the quickest whole one, or null.
  fastest: number | null
  units: 'imperial' | 'metric'
  // Which split is picked out on the route, by its place in the list.
  chosen: number | null
  // Whether there is a line to pick anything out on. Without one the rows are
  // rows: a control that would do nothing is not offered.
  lined: boolean
  onChoose: (next: number | null) => void
}) {
  if (splits.length === 0) return null
  const unit = distanceUnit(units)
  // The range the bars are spread across: this session's own quickest and
  // slowest split, rather than the quickest one alone.
  const paces = splits.map((split) => split.pace_s_per_unit).filter((pace) => pace > 0)
  const fastest = paces.length === 0 ? 0 : Math.min(...paces)
  const slowest = paces.length === 0 ? 0 : Math.max(...paces)
  // The quickest whole split, which the bars alone do not name. The tail is in
  // the range above and is never the one marked.
  const quickest = splits.find((split) => split.index === named) ?? null

  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">Splits</p>
      {splits.map((split, index) => {
        const marked = chosen === index
        const figures = (
          <>
            {/* A last split that ended part way through says how far it
                actually went, in the place the whole ones say which one they
                are: a row reading quicker than the one above it is then
                accounted for rather than confusing. */}
            <span className="w-16 shrink-0">
              {split.whole
                ? `${split.index} ${unit}`
                : `${distanceIn(split.distance_m, units).toFixed(2)} ${unit}`}
            </span>
            {/* The quickest whole split is marked on its own pace, which is the
                figure the mark is about. Colour and nothing else, because the
                line under the list names it in words. */}
            <span
              className={`t-nums w-20 shrink-0 ${
                quickest !== null && quickest.index === split.index ? 'text-blue' : ''
              }`}
            >
              {paceFromUnit(split.pace_s_per_unit, units)}
            </span>
            <span
              className="h-1.5 min-w-6 flex-1 rounded-full"
              style={{ background: 'var(--line)' }}
            >
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${splitShare(split.pace_s_per_unit, fastest, slowest).toFixed(1)}%`,
                  background: 'var(--blue)',
                }}
              />
            </span>
            <span className="t-nums w-16 shrink-0 text-right text-muted">
              {split.hr === null ? '' : `${split.hr} bpm`}
            </span>
          </>
        )
        return lined ? (
          <button
            key={split.index}
            type="button"
            className={`t-row -mx-2 min-h-9 w-[calc(100%+1rem)] rounded-lg px-2 text-sm ${
              marked ? 'bg-surface-2' : ''
            }`}
            aria-pressed={marked}
            onClick={() => onChoose(marked ? null : index)}
          >
            {figures}
          </button>
        ) : (
          <div key={split.index} className="t-row min-h-9 text-sm">
            {figures}
          </div>
        )
      })}
      {quickest !== null && (
        <p className="mt-2 text-xs text-muted">{fastestLine(quickest, units)}</p>
      )}
      {lined && <p className="mt-1 text-xs text-muted">Tap a split to see it on the route</p>}
    </div>
  )
}

export function WorkoutDetails({
  me,
  workoutId,
  back = 'Fitness',
  onBack,
  onOpenMember,
  onChanged,
}: {
  me: Me
  workoutId: number
  // What the way back is called, because this screen is opened from four.
  back?: string
  onBack: () => void
  // Somebody else's workout names who did it, and the name is a way to them.
  onOpenMember?: (userId: number) => void
  // Hiding a workout changes a list that is very likely on screen already.
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<WorkoutDetail | null>(null)
  const [failed, setFailed] = useState('')
  // What went wrong with the last hide, said under the switch it belongs to.
  const [hideError, setHideError] = useState('')
  // Which split is picked out on the route, by its place in the list. Null is
  // none, which is where every workout starts and where a second tap on the
  // same row puts it back.
  const [chosen, setChosen] = useState<number | null>(null)
  // Whether this instance was given the basemap and this browser can draw one.
  // The archive is asked once a session with a request for a single byte, and
  // this is false until it answers, so the drawn line is what a slow answer
  // leaves on the screen.
  const [mapped, setMapped] = useState(false)
  // The way to move the dot along the route line, filled in by the drawing and
  // driven by the graph's cursor.
  const marker = useRef<RouteMarker | null>(null)

  useEffect(() => {
    let alive = true
    setChosen(null)
    api<WorkoutDetail>(`/workouts/${workoutId}`)
      .then((row) => alive && setDetail(row))
      .catch((failure) => alive && setFailed(errorText(failure)))
    return () => {
      alive = false
    }
  }, [workoutId])

  useEffect(() => {
    let alive = true
    void basemapInstalled().then((yes) => alive && setMapped(yes && canDrawMaps()))
    return () => {
      alive = false
    }
  }, [])

  useTopBar({
    title: detail?.activity ?? 'Workout',
    back: { label: back, onBack },
  })

  if (failed !== '') return <p className="t-error">{failed}</p>
  if (detail === null) return <p className="text-sm text-muted">Loading.</p>

  // What the sharing left out is absent, so each of these can be empty.
  const samples = detail.samples ?? []
  const splits = detail.splits ?? []
  const pace =
    present(detail.duration_s) && present(detail.distance_m)
      ? paceText(detail.distance_m, detail.duration_s, me.units)
      : null
  const route = detail.route ?? null
  // Whether there is a line to find anything on. A workout whose route is
  // hidden, missing, or too short to draw has none.
  const lined = route !== null && route.length > 1
  // Where each split and each minute fall along the session, which is how each
  // of them is found on the line. Worked out only where there is one.
  const spans = lined ? spansOf(splits) : []
  const places = lined ? placesOf(samples) : new Map<number, number>()
  // Whether the numbers card has a figure in it at all.
  const stats =
    present(detail.duration_s) ||
    present(detail.distance_m) ||
    present(detail.kcal) ||
    present(detail.avg_hr) ||
    present(detail.max_hr) ||
    present(detail.elevation_gain_m)
  // A friend whose sharing left every card out reads the header and one line.
  const bare =
    !detail.mine && !stats && !lined && samples.length === 0 && splits.length === 0

  // The switch moves at once and moves back if the server says no: a member
  // deciding who sees a morning should not wait on a round trip.
  const setHidden = async (hidden: boolean) => {
    const was = detail.hidden_from_feed
    setHideError('')
    setDetail({ ...detail, hidden_from_feed: hidden })
    try {
      await api(`/workouts/${detail.id}`, {
        method: 'PATCH',
        body: { hidden_from_feed: hidden },
      })
      onChanged?.()
    } catch (failure) {
      setDetail({ ...detail, hidden_from_feed: was })
      setHideError(errorText(failure))
    }
  }

  return (
    <>
      <div className="t-card mb-3">
        {/* The bar carries the name too, but a page about one morning ought to
            say what it was without being scrolled to the top. */}
        <p className="mb-1 flex items-center gap-2 text-base font-semibold tracking-tight">
          <ActivityIcon name={detail.activity} className="h-5 w-5 shrink-0 text-muted" />
          <span className="min-w-0 truncate">{detail.activity}</span>
        </p>
        <p className="mb-2 text-sm text-muted">
          {!detail.mine && onOpenMember !== undefined && (
            <>
              <button
                type="button"
                className="underline decoration-line underline-offset-2"
                onClick={() => onOpenMember(detail.user_id)}
              >
                {detail.display_name}
              </button>
              {' · '}
            </>
          )}
          {dayLabel(detail.date, today(me.timezone))}
          {detail.indoor ? ' · Indoors' : ''}
        </p>
        {bare && (
          <p className="text-sm text-muted">
            {detail.display_name} shares only the activity and the date.
          </p>
        )}
        {stats && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {present(detail.duration_s) && (
              <Stat label="Time" value={durationText(detail.duration_s)} />
            )}
            {present(detail.distance_m) && (
              <Stat label="Distance" value={distanceText(detail.distance_m, me.units)} />
            )}
            {present(detail.kcal) && <Stat label="Calories" value={`${detail.kcal} cal`} />}
            {pace !== null && <Stat label="Pace" value={pace} />}
            {present(detail.avg_hr) && (
              <Stat label="AVG H.R" value={`${detail.avg_hr} bpm`} />
            )}
            {present(detail.max_hr) && <Stat label="MAX H.R" value={`${detail.max_hr} bpm`} />}
            {present(detail.elevation_gain_m) && (
              <Stat
                label="Climb"
                value={
                  me.units === 'metric'
                    ? `${Math.round(detail.elevation_gain_m)} m`
                    : `${Math.round(detail.elevation_gain_m / 0.3048)} ft`
                }
              />
            )}
          </div>
        )}
        {(detail.flags ?? []).map((flag) => (
          <p key={flag} className="mt-3 text-xs text-muted">
            {FLAG_TEXT[flag] ?? 'One of these numbers looked unusual to Tare.'}
          </p>
        ))}
      </div>

      {route !== null && route.length > 1 && (
        <div className="t-card mb-3">
          <p className="t-micro mb-2">Route</p>
          {mapped ? (
            <MapGuard
              key={workoutId}
              fallback={
                <RouteLine
                  points={route}
                  highlight={chosen === null ? null : (spans[chosen] ?? null)}
                  marker={marker}
                />
              }
            >
              <Suspense
                fallback={
                  <RouteLine
                    points={route}
                    highlight={chosen === null ? null : (spans[chosen] ?? null)}
                  />
                }
              >
                <RouteMap
                  points={route}
                  highlight={chosen === null ? null : (spans[chosen] ?? null)}
                  marker={marker}
                />
              </Suspense>
            </MapGuard>
          ) : (
            <RouteLine
              points={route}
              highlight={chosen === null ? null : (spans[chosen] ?? null)}
              marker={marker}
            />
          )}
          <p className="mt-1 text-xs text-muted">
            Start and end areas hidden
          </p>
        </div>
      )}

      <LaneGraph
        samples={samples}
        units={me.units}
        places={places}
        marker={marker}
        route={lined ? route : null}
      />
      <Splits
        splits={splits}
        fastest={detail.fastest ?? null}
        units={me.units}
        chosen={chosen}
        lined={lined}
        onChoose={setChosen}
      />

      {detail.mine && (
        <div className="t-card mb-3">
          <Switch
            label="Show in the community feed"
            note="Friends see what your Sharing settings allow."
            checked={!detail.hidden_from_feed}
            onChange={(next) => setHidden(!next)}
          />
          {hideError && <p className="t-error mt-2">{hideError}</p>}
        </div>
      )}
    </>
  )
}
