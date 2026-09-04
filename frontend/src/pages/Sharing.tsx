import { useEffect, useState } from 'react'

import { api, errorText, type Me, type Profile } from '../api'
import { SaveMarks, useSavedChip } from '../components/SaveMarks'
import { Switch } from '../components/Switch'
import { useTopBar } from '../hooks/useTopBar'

// The one screen that says what leaves this account. Nothing here saves until
// the button: turning a switch is a draft, not an announcement.

const SEX_LABEL: Record<string, string> = { female: 'Female', male: 'Male' }

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
  // Read here rather than passed in: the sex a switch would show lives on the
  // health profile, and this is the only screen that needs it.
  const [profile, setProfile] = useState<Profile | null>(null)
  const [age, setAge] = useState(me.share_age)
  const [sex, setSex] = useState(me.share_sex)
  const [place, setPlace] = useState(me.share_location)
  // Held the way the screen reads them: on means shown, and the server is
  // told what is hidden.
  const [hidden, setHidden] = useState<string[]>(me.feed_hidden)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useSavedChip()

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
    sex !== me.share_sex ||
    place !== me.share_location ||
    hidden.join() !== me.feed_hidden.join()

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
            share_sex: sex,
            share_location: place,
          },
        })
      )
      markSaved()
    } catch (failure) {
      setError(errorText(failure))
    }
    setSaving(false)
  }

  const ageNote =
    me.birthdate === null
      ? 'Add your date of birth on Profile'
      : `${ageOf(me.birthdate)}, which is what they would see`
  const sexNote =
    profile === null || profile.sex === null
      ? 'Add it on Profile'
      : (SEX_LABEL[profile.sex] ?? profile.sex)
  const placeNote = me.location === null ? 'Add it on Profile' : me.location

  return (
    <>
      <p className="t-micro mb-1">About you</p>
      <div className="t-card mb-3">
        <Switch label="Show my age" note={ageNote} checked={age} onChange={setAge} />
        <Switch label="Show my sex" note={sexNote} checked={sex} onChange={setSex} />
        <Switch
          label="Show where I live"
          note={placeNote}
          checked={place}
          onChange={setPlace}
        />
      </div>

      <p className="t-micro mb-1">Your workouts</p>
      <div className="t-card mb-3">
        <Switch
          label="Heart rate"
          checked={shows('avg_hr')}
          onChange={(next) => show('avg_hr', next)}
        />
        <Switch
          label="Calories"
          checked={shows('kcal')}
          onChange={(next) => show('kcal', next)}
        />
        <Switch
          label="Route line"
          checked={shows('route')}
          onChange={(next) => show('route', next)}
        />
        <p className="mt-2 text-xs text-muted">
          Workouts are shared with members unless you hide one from its own page. Workouts
          from a file start hidden.
        </p>
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
