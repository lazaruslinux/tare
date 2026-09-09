import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { BirthdateField } from '../components/BirthdateField'
import { CircleHelp } from 'lucide-react'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { Sheet } from '../components/Sheet'

import { api, errorText, uploadFile, type Me, type Profile as ProfileRow, type Sex } from '../api'
import { Avatar } from '../components/Avatar'
import { AvatarCrop } from '../components/AvatarCrop'
import { useInstantSave } from '../components/SaveMarks'
import { heightParts, partsToCm } from '../lib/units'

const SEXES: { value: Sex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
]

const asNumber = (raw: string): number | null => {
  const value = Number(raw.trim())
  return raw.trim() === '' || Number.isNaN(value) ? null : value
}

export function Profile({
  me,
  onChange,
}: {
  me: Me
  onChange: (me: Me) => void
  // The one thing on this screen that is not a setting: a weight is a
  // measurement, and it is recorded where measurements are.
}) {
  const metric = me.units === 'metric'
  // The one thing on this screen other members read, so it is the first thing
  // on it. It lives on the account rather than the profile, and it is saved on
  // its own: nothing else here is anybody else's business.
  const [displayName, setDisplayName] = useState(me.display_name ?? '')
  const nameSave = useInstantSave()
  const [sex, setSex] = useState<Sex | null>(null)
  const [feet, setFeet] = useState('')
  const [inches, setInches] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [birthdate, setBirthdate] = useState('')
  const [location, setLocation] = useState('')
  const [expecting, setExpecting] = useState(false)
  const [about, setAbout] = useState(false)
  // Only the first read of the profile sets this; everything typed after it
  // reports through the card's own chip.
  const [error, setError] = useState('')
  const factsSave = useInstantSave()
  // The picture being framed, the request carrying it, and what went wrong.
  const [picked, setPicked] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [pictureError, setPictureError] = useState('')
  // Whether the question about taking the photo off is up.
  const [removingPhoto, setRemovingPhoto] = useState(false)
  // The file input is reset after every pick, so choosing the same file twice
  // in a row still opens the framing sheet the second time.
  const chooser = useRef<HTMLInputElement>(null)
  // What the server last took for each field that saves on leaving it, so a
  // blur straight after an enter does not send the same value twice.
  const sentName = useRef(me.display_name ?? '')
  const sentCm = useRef<number | null>(null)
  const sentPlace = useRef('')
  const sentBirthdate = useRef('')

  useEffect(() => {
    let alive = true
    api<ProfileRow>('/health/profile')
      .then((loaded) => {
        if (!alive) return
        setSex(loaded.sex)
        setBirthdate(loaded.birthdate ?? '')
        setLocation(loaded.location ?? '')
        sentPlace.current = loaded.location ?? ''
        sentBirthdate.current = loaded.birthdate ?? ''
        setExpecting(loaded.pregnant_or_breastfeeding)
        if (loaded.height_cm === null) return
        sentCm.current = Math.round(loaded.height_cm)
        setHeightCm(String(Math.round(loaded.height_cm)))
        const parts = heightParts(loaded.height_cm)
        setFeet(String(parts.feet))
        setInches(String(parts.inches))
      })
      .catch((failure) => alive && setError(errorText(failure)))
    return () => {
      alive = false
    }
  }, [])

  // A name is what other members read, so an empty box is not an edit: it is
  // left alone until there is something in it.
  const commitName = () => {
    const next = displayName
    if (next.trim() === '' || next === sentName.current) return
    const was = sentName.current
    sentName.current = next
    nameSave.run(async () => {
      try {
        onChange(await api<Me>('/account', { method: 'PATCH', body: { display_name: next } }))
      } catch (failure) {
        sentName.current = was
        setDisplayName(was)
        throw failure
      }
    })
  }

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    setPictureError('')
    if (file !== null) setPicked(file)
  }

  const sendPicture = async (blob: Blob) => {
    setSending(true)
    setPictureError('')
    try {
      const answer = await uploadFile<{ avatar_url: string }>(
        '/account/avatar',
        new File([blob], 'avatar.jpg', { type: blob.type })
      )
      onChange({ ...me, avatar_url: answer.avatar_url })
      setPicked(null)
    } catch (failure) {
      setPictureError(errorText(failure))
    }
    setSending(false)
  }

  const removePicture = async () => {
    setSending(true)
    setPictureError('')
    try {
      await api('/account/avatar', { method: 'DELETE' })
      onChange({ ...me, avatar_url: null })
    } catch (failure) {
      setPictureError(errorText(failure))
    }
    setSending(false)
  }

  const centimetres = (): number | null => {
    if (metric) return asNumber(heightCm)
    const ft = asNumber(feet)
    if (ft === null) return null
    return partsToCm(ft, asNumber(inches) ?? 0)
  }

  // One field at a time, as it is left. A failure puts the control back on
  // what the server still holds and the card says why.
  const putProfile = (body: Record<string, unknown>, undo: () => void) =>
    factsSave.run(async () => {
      try {
        await api<ProfileRow>('/health/profile', { method: 'PUT', body })
      } catch (failure) {
        undo()
        throw failure
      }
    })

  const commitHeight = () => {
    const cm = centimetres()
    const next = cm === null ? null : Math.round(cm)
    if (next === sentCm.current) return
    const was = sentCm.current
    sentCm.current = next
    putProfile({ height_cm: next }, () => {
      sentCm.current = was
      setHeightCm(was === null ? '' : String(was))
      const parts = was === null ? null : heightParts(was)
      setFeet(parts === null ? '' : String(parts.feet))
      setInches(parts === null ? '' : String(parts.inches))
    })
  }

  const commitPlace = () => {
    if (location === sentPlace.current) return
    const was = sentPlace.current
    sentPlace.current = location
    putProfile({ location }, () => {
      sentPlace.current = was
      setLocation(was)
    })
  }

  // The birthdate lives on the account rather than the profile, and it is held
  // to the same rule the front door holds everybody to. A part-typed date
  // reads as empty, so only a whole one is sent.
  const commitBirthdate = (next: string) => {
    if (next === '' || next === sentBirthdate.current) return
    const was = sentBirthdate.current
    sentBirthdate.current = next
    factsSave.run(async () => {
      try {
        onChange(await api<Me>('/account', { method: 'PATCH', body: { birthdate: next } }))
      } catch (failure) {
        sentBirthdate.current = was
        setBirthdate(was)
        throw failure
      }
    })
  }

  return (
    <>
    <div className="t-card mb-3">
      <div className="t-row">
        <label className="flex-1 whitespace-nowrap text-sm" htmlFor="settings-display-name">
          Display name
        </label>
        <input
          id="settings-display-name"
          className="t-input max-w-[55%]"
          autoComplete="nickname"
          placeholder={me.username}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => event.key === 'Enter' && commitName()}
        />
        {nameSave.saved && <span className="t-chip text-accent">Saved.</span>}
      </div>
      {nameSave.error && <p className="t-error mt-2">{nameSave.error}</p>}
    </div>

    <div className="t-card mb-3">
      <p className="t-micro mb-3">Avatar</p>
      <div className="flex items-center gap-4">
        <Avatar url={me.avatar_url} name={me.display_name || me.username} size="page" />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <label className="t-btn cursor-pointer">
            Choose a photo
            <input
              ref={chooser}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={choose}
            />
          </label>
          {me.avatar_url !== null && (
            <button
              type="button"
              className="t-btn"
              disabled={sending}
              onClick={() => setRemovingPhoto(true)}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {pictureError !== '' && picked === null && <p className="t-error mt-3">{pictureError}</p>}
      <p className="mt-3 text-xs text-muted">
        Other members see your avatar and display name.
      </p>
    </div>

    {picked !== null && (
      <AvatarCrop
        file={picked}
        busy={sending}
        failed={pictureError}
        onCancel={() => {
          setPicked(null)
          setPictureError('')
        }}
        onSave={sendPicture}
      />
    )}

    <div className="t-card mb-3">
      <div className="flex min-h-7 items-center gap-3">
        <p className="t-label flex-1">Gender</p>
        {factsSave.saved && <span className="t-chip mb-1.5 text-accent">Saved.</span>}
      </div>
      <div className="mb-1 flex gap-3">
        {SEXES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={sex === choice.value}
            className="t-choice"
            onClick={() => {
              const next = sex === choice.value ? null : choice.value
              const wasSex = sex
              const wasExpecting = expecting
              const body: Record<string, unknown> = { sex: next }
              setSex(next)
              if (next === 'male' && expecting) {
                setExpecting(false)
                body.pregnant_or_breastfeeding = false
              }
              putProfile(body, () => {
                setSex(wasSex)
                setExpecting(wasExpecting)
              })
            }}
          >
            <span className="block text-sm font-semibold">{choice.label}</span>
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">
        Used only to estimate how much energy your body uses.
      </p>

      <p className="t-label">Height</p>
      {metric ? (
        <input
          className="t-input mb-4"
          type="number"
          inputMode="numeric"
          placeholder="cm"
          aria-label="Height in centimetres"
          value={heightCm}
          onChange={(event) => setHeightCm(event.target.value)}
          onBlur={commitHeight}
          onKeyDown={(event) => event.key === 'Enter' && commitHeight()}
        />
      ) : (
        <div className="mb-4 flex gap-3">
          <input
            className="t-input"
            type="number"
            inputMode="numeric"
            placeholder="ft"
            aria-label="Height in feet"
            value={feet}
            onChange={(event) => setFeet(event.target.value)}
            onBlur={commitHeight}
            onKeyDown={(event) => event.key === 'Enter' && commitHeight()}
          />
          <input
            className="t-input"
            type="number"
            inputMode="numeric"
            placeholder="in"
            aria-label="Height in inches"
            value={inches}
            onChange={(event) => setInches(event.target.value)}
            onBlur={commitHeight}
            onKeyDown={(event) => event.key === 'Enter' && commitHeight()}
          />
        </div>
      )}

      <div className="mb-4">
        <label className="t-label" htmlFor="profile-birthdate">
          Date of birth
        </label>
        <BirthdateField
          id="profile-birthdate"
          value={birthdate}
          onChange={(iso) => {
            setBirthdate(iso)
            commitBirthdate(iso)
          }}
        />
        <p className="mt-1 text-xs text-muted">Tare is for adults 18 and over.</p>
      </div>

      <div className="mb-4">
        <label className="t-label" htmlFor="profile-location">
          City, State
        </label>
        <input
          id="profile-location"
          className="t-input"
          autoComplete="address-level2"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
          onBlur={commitPlace}
          onKeyDown={(event) => event.key === 'Enter' && commitPlace()}
        />
      </div>

      {sex !== 'male' && (
        <div className="t-row">
          <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-accent"
              checked={expecting}
              onChange={(event) => {
                const next = event.target.checked
                setExpecting(next)
                putProfile({ pregnant_or_breastfeeding: next }, () => setExpecting(!next))
              }}
            />
            <span className="min-w-0">Adjust calculations for pregnancy/breastfeeding</span>
          </label>
          <button
            type="button"
            className="t-tap44 shrink-0 text-muted"
            aria-label="About this adjustment"
            onClick={() => setAbout(true)}
          >
            <CircleHelp className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {(factsSave.error || error) && (
        <p className="t-error mt-3">{factsSave.error || error}</p>
      )}

      <p className="mt-3 text-xs text-muted">
        Everything on this screen is private to you unless you choose to share it on
        the Sharing screen.
      </p>
    </div>

      <ConfirmSheet
        open={removingPhoto}
        label="Remove your photo"
        question="Remove your photo?"
        verb="Remove"
        busy={sending}
        onConfirm={() => {
          setRemovingPhoto(false)
          void removePicture()
        }}
        onClose={() => setRemovingPhoto(false)}
      />

      <Sheet open={about} label="Pregnancy and breastfeeding" onClose={() => setAbout(false)}>
        <p className="text-sm">
          While on, weight-loss goals pause and your budget matches what you use, with
          no deficit. Nothing extra is added, since needs change by trimester and while
          breastfeeding. Ask your clinician for the right number.
        </p>
      </Sheet>
    </>
  )
}
