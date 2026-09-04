import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

import { api, errorText, type Me, type Profile } from '../api'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { Switch } from '../components/Switch'
import { useTopBar } from '../hooks/useTopBar'

// The one screen that says what leaves this account. Nothing here saves until
// the button: turning a switch is a draft, not an announcement.

const GENDER_LABEL: Record<string, string> = { female: 'Female', male: 'Male' }

// The three parts of a workout a member may keep back, by the names the server
// holds them under.
const HIDEABLE = ['avg_hr', 'kcal', 'route'] as const

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
}: {
  me: Me
  onChange: (me: Me) => void
  onBack: () => void
}) {
  // Read here rather than passed in: the gender a switch would show lives on
  // the health profile, and this is the only screen that needs it.
  const [profile, setProfile] = useState<Profile | null>(null)
  const [age, setAge] = useState(me.share_age)
  const [gender, setGender] = useState(me.share_sex)
  const [place, setPlace] = useState(me.share_location)
  const [workouts, setWorkouts] = useState(me.share_workouts)
  // Held the way the screen reads them: on means shown, and the server is
  // told what is hidden.
  const [hidden, setHidden] = useState<string[]>(me.feed_hidden)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useSavedChip()
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

  const dirty =
    age !== me.share_age ||
    gender !== me.share_sex ||
    place !== me.share_location ||
    workouts !== me.share_workouts ||
    hidden.join() !== me.feed_hidden.join()

  // The master switch takes the three with it: off folds them away and turns
  // them off, on brings them back at their defaults, all shown.
  const shareWorkouts = (next: boolean) => {
    setWorkouts(next)
    setHidden(next ? [] : [...HIDEABLE])
  }

  const shows = (name: string) => !hidden.includes(name)
  // Kept in the order the server names them, so a comparison against what was
  // saved is a comparison of two lists and not of two orderings.
  const show = (name: string, next: boolean) => {
    const held = new Set(hidden)
    if (next) held.delete(name)
    else held.add(name)
    setHidden(HIDEABLE.filter((each) => held.has(each)))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      onChange(
        await api<Me>('/account', {
          method: 'PATCH',
          body: {
            feed_hidden: hidden,
            share_age: age,
            share_sex: gender,
            share_location: place,
            share_workouts: workouts,
          },
        })
      )
      markSaved()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSaving(false)
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
      <p className="t-micro mb-1">Privacy settings</p>
      <div className="t-card mb-3">
        <p className="text-sm text-muted">Show my:</p>
        <Switch label={ageLabel} checked={age} onChange={setAge} />
        <Switch label={genderLabel} checked={gender} onChange={setGender} />
        <Switch label={placeLabel} checked={place} onChange={setPlace} />
        <p className="mt-2 text-xs text-muted">These can be edited in your profile settings.</p>
      </div>

      <p className="t-micro mb-1">Workout privacy settings</p>
      <div className="t-card mb-3">
        <Switch label="Share my workouts" checked={workouts} onChange={shareWorkouts} />
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
                label="Heart rate (during workout only)"
                checked={shows('avg_hr')}
                onChange={(next) => show('avg_hr', next)}
              />
              <Switch
                label="Calories burned"
                checked={shows('kcal')}
                onChange={(next) => show('kcal', next)}
              />
              <Switch
                label="Route line (not GPS location)"
                checked={shows('route')}
                onChange={(next) => show('route', next)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          className="t-btn t-btn-primary"
          disabled={!dirty || saving}
          onClick={save}
        >
          Save
        </button>
        <SaveMarks dirty={dirty} saved={saved} />
      </div>

      <p className="text-xs text-muted">Everything else stays private to you.</p>
    </>
  )
}
