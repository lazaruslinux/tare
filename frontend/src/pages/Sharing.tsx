import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, type Me, type Profile } from '../api'
import { useInstantSave } from '../components/SaveMarks'
import { Switch } from '../components/Switch'
import { useTopBar } from '../hooks/useTopBar'

// The one screen that says what leaves this account. Every switch saves itself
// as it is turned, and each card says so on its own heading.

const GENDER_LABEL: Record<string, string> = { female: 'Female', male: 'Male' }

// The two things a member may keep back on a workout, by the names the server
// holds them under.
const HIDEABLE = ['details', 'route'] as const

function ageOf(birthdate: string): number {
  const born = new Date(`${birthdate}T00:00:00Z`)
  const now = new Date()
  const had =
    now.getUTCMonth() > born.getUTCMonth() ||
    (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() >= born.getUTCDate())
  return now.getUTCFullYear() - born.getUTCFullYear() - (had ? 0 : 1)
}

export function Sharing({
  me,
  onChange,
  onBack,
  onOpenProfile,
}: {
  me: Me
  onChange: (me: Me) => void
  onBack: () => void
  // The page every other member sees, opened from the switches that decide
  // what is on it.
  onOpenProfile: () => void
}) {
  // Read here rather than passed in: the gender a switch would show lives on
  // the health profile, and this is the only screen that needs it.
  const [profile, setProfile] = useState<Profile | null>(null)
  const [age, setAge] = useState(me.share_age)
  const [gender, setGender] = useState(me.share_sex)
  const [place, setPlace] = useState(me.share_location)
  const [workouts, setWorkouts] = useState(me.share_workouts)
  const [journal, setJournal] = useState(me.share_journal)
  const [loss, setLoss] = useState(me.share_weight_loss)
  // Held the way the screen reads them: on means shown, and the server is
  // told what is hidden.
  const [hidden, setHidden] = useState<string[]>(me.feed_hidden)
  // One per card, so the card that was touched is the card that answers.
  const profileSave = useInstantSave()
  const workoutSave = useInstantSave()
  const journalSave = useInstantSave()
  const weightSave = useInstantSave()
  const reduced = useReducedMotion()

  useTopBar({ title: 'Sharing', back: { label: 'More', onBack } })

  useEffect(() => {
    let alive = true
    api<Profile>('/health/profile')
      .then((row) => alive && setProfile(row))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  // Straight to the server, one card's fields at a time. A failure puts the
  // switch back where it was and the card says why.
  const patch = (
    run: (save: () => Promise<void>) => void,
    body: Record<string, unknown>,
    undo: () => void
  ) =>
    run(async () => {
      try {
        onChange(await api<Me>('/account', { method: 'PATCH', body }))
      } catch (failure) {
        undo()
        throw failure
      }
    })

  // The master switch takes the rest with it: off folds them away and holds
  // everything back.
  const shareWorkouts = (next: boolean) => {
    // Turning it back on brings back the row, not the breakdown: details are
    // held until the switch under this one is turned.
    const parts = next ? ['details'] : [...HIDEABLE]
    const wasHidden = hidden
    setWorkouts(next)
    setHidden(parts)
    patch(workoutSave.run, { share_workouts: next, feed_hidden: parts }, () => {
      setWorkouts(!next)
      setHidden(wasHidden)
    })
  }

  const shows = (name: string) => !hidden.includes(name)
  // Kept in the order the server names them, so what is sent is a list in the
  // server's own order rather than in the order the switches were touched.
  const show = (name: string, next: boolean) => {
    const held = new Set(hidden)
    if (next) held.delete(name)
    else held.add(name)
    const parts = HIDEABLE.filter((each) => held.has(each))
    const wasHidden = hidden
    setHidden(parts)
    patch(workoutSave.run, { feed_hidden: parts }, () => setHidden(wasHidden))
  }

  // Each label carries the fact itself, so what a member turns on is exactly
  // what they read here. Until the profile answers, the gender row is the
  // bare word rather than a guess.
  const MISSING = 'not set'
  const ageLabel = `Age (${me.birthdate === null ? MISSING : ageOf(me.birthdate)})`
  const genderLabel =
    profile === null
      ? 'Gender'
      : `Gender (${profile.sex === null ? MISSING : (GENDER_LABEL[profile.sex] ?? profile.sex)})`
  const placeLabel = `Location (${me.location === null ? MISSING : me.location})`

  return (
    <>
      <p className="mb-3 text-sm text-muted">Only your friends see what you share here.</p>
      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Profile</p>
        {profileSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <p className="text-sm text-muted">Show my:</p>
        <Switch
          label={ageLabel}
          checked={age}
          onChange={(next) => {
            setAge(next)
            patch(profileSave.run, { share_age: next }, () => setAge(!next))
          }}
        />
        <Switch
          label={genderLabel}
          checked={gender}
          onChange={(next) => {
            setGender(next)
            patch(profileSave.run, { share_sex: next }, () => setGender(!next))
          }}
        />
        <Switch
          label={placeLabel}
          checked={place}
          onChange={(next) => {
            setPlace(next)
            patch(profileSave.run, { share_location: next }, () => setPlace(!next))
          }}
        />
        <button type="button" className="t-row w-full text-left" onClick={onOpenProfile}>
          <span className="flex-1 text-sm">View my public profile</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={2} />
        </button>
        <p className="mt-2 text-xs text-muted">These can be edited in your profile settings.</p>
        {profileSave.error && <p className="t-error mt-2">{profileSave.error}</p>}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Workouts</p>
        {workoutSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <Switch
          label="Share when I've synced a workout"
          checked={workouts}
          onChange={shareWorkouts}
        />
        <AnimatePresence initial={false}>
          {workouts && (
            <motion.div
              key="parts"
              className="overflow-hidden"
              initial={reduced ? false : { height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={reduced ? undefined : { height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <Switch
                label="Allow other members to see my workout details"
                note="Stats, minute-by-minute and splits. Off unless you turn it on."
                checked={shows('details')}
                onChange={(next) => show('details', next)}
              />
              {/* The route only means anything once the details are open, so
                  it is only offered there. */}
              <AnimatePresence initial={false}>
                {shows('details') && (
                  <motion.div
                    key="route"
                    className="overflow-hidden"
                    initial={reduced ? false : { height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={reduced ? undefined : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <Switch
                      label="Show route maps"
                      note="Tare automatically hides the first 200 meters of the start and end of all activities with route data."
                      checked={shows('route')}
                      onChange={(next) => show('route', next)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
        {workoutSave.error && <p className="t-error mt-2">{workoutSave.error}</p>}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Journal</p>
        {journalSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <Switch
          label="Share when I complete my journal"
          checked={journal}
          onChange={(next) => {
            setJournal(next)
            patch(journalSave.run, { share_journal: next }, () => setJournal(!next))
          }}
        />
        {journalSave.error && <p className="t-error mt-2">{journalSave.error}</p>}
      </div>

      <div className="mb-1 flex min-h-7 items-center gap-3">
        <p className="t-micro flex-1">Weight</p>
        {weightSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      <div className="t-card mb-3">
        <Switch
          label="Share weight lost since last weigh-in"
          checked={loss}
          onChange={(next) => {
            setLoss(next)
            patch(weightSave.run, { share_weight_loss: next }, () => setLoss(!next))
          }}
        />
        <p className="mt-2 text-xs text-muted">
          Friends see how much you lost since your last weigh-in, never your weight.
        </p>
        {weightSave.error && <p className="t-error mt-2">{weightSave.error}</p>}
      </div>

      <p className="text-xs text-muted">Everything else stays private to you.</p>
    </>
  )
}
