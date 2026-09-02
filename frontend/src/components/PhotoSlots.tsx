import { Camera, X } from 'lucide-react'
import { useId, useState, type ChangeEvent } from 'react'

import { errorText, upload, type PhotoPurpose } from '../api'
import { MAX_PHOTO_BYTES, PHOTO_TOO_LARGE } from '../lib/community'

// The two pictures a food offered to everybody carries: the front of the pack,
// which is what somebody recognises it by, and the nutrition label, which is
// what whoever reviews it checks the ten numbers against.
//
// The label one is never shown to anybody but its uploader and an
// administrator, and the slot says so out loud rather than leaving somebody to
// wonder where a photograph of their kitchen counter ends up.

// A slot holds either a picture this step uploaded, which can be taken back,
// or one the food already carries, which is shown and left alone.
export type Slot = { id: number | null; url?: string | null; required: boolean }

function Tile({
  photoId,
  standing,
  title,
  note,
  busy,
  purpose,
  onPicked,
  onCleared,
  onFailed,
}: {
  photoId: number | null
  standing?: string | null
  title: string
  note: string
  busy: boolean
  purpose: PhotoPurpose
  onPicked: (id: number) => void
  onCleared: () => void
  onFailed: (message: string) => void
}) {
  const field = useId()
  const [uploading, setUploading] = useState(false)
  const shown = photoId === null ? (standing ?? null) : `/api/photos/${photoId}.webp`

  const take = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared either way, so choosing the same file twice still fires.
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_PHOTO_BYTES) {
      onFailed(PHOTO_TOO_LARGE)
      return
    }
    setUploading(true)
    try {
      const { photo_id } = await upload<{ photo_id: number }>('/photos', file, purpose)
      onPicked(photo_id)
    } catch (failure) {
      onFailed(errorText(failure))
    }
    setUploading(false)
  }

  return (
    <div className="min-w-0 flex-1">
      {shown === null ? (
        <label className="t-phototile h-24 w-24 cursor-pointer rounded-xl" htmlFor={field}>
          <Camera className="h-6 w-6" strokeWidth={1.75} />
          <span className="sr-only">{title}</span>
        </label>
      ) : (
        <div className="relative h-24 w-24">
          <img
            src={shown}
            alt={title}
            className="h-24 w-24 rounded-xl border border-line object-cover"
          />
          {/* Only the one this step uploaded. A picture the food already
              carries is managed on the food, not here. */}
          {photoId !== null && (
            <button
              type="button"
              className="t-tap44 absolute -top-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-2 text-muted"
              aria-label={`Remove ${title.toLowerCase()}`}
              onClick={onCleared}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
      <input
        id={field}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy || uploading}
        onChange={take}
      />
      <p className="mt-2 text-sm">{title}</p>
      <p className="text-xs text-muted">{uploading ? 'Adding' : note}</p>
    </div>
  )
}

export function PhotoSlots({
  front,
  label,
  busy,
  onFront,
  onLabel,
  onFailed,
}: {
  front: Slot
  label: Slot
  busy?: boolean
  onFront: (id: number | null) => void
  onLabel: (id: number | null) => void
  onFailed: (message: string) => void
}) {
  return (
    <div className="t-card mb-3">
      <p className="t-micro mb-2">Photos</p>
      <div className="flex gap-4">
        <Tile
          photoId={front.id}
          standing={front.url}
          title="Front of the pack"
          note={front.required ? 'Needed' : 'Optional'}
          busy={Boolean(busy)}
          purpose="front"
          onPicked={onFront}
          onCleared={() => onFront(null)}
          onFailed={onFailed}
        />
        <Tile
          photoId={label.id}
          standing={label.url}
          title="Nutrition label"
          note={
            label.required
              ? 'Needed. Only admins see this one.'
              : 'Optional. Only admins see this one.'
          }
          busy={Boolean(busy)}
          purpose="label"
          onPicked={onLabel}
          onCleared={() => onLabel(null)}
          onFailed={onFailed}
        />
      </div>
    </div>
  )
}
