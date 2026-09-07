import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type AdminInvite } from '../api'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useTopBar } from '../hooks/useTopBar'

// The links that let somebody in. Three at a time on purpose: a link with a
// seat left on it is a way into the instance, and a page that mints them
// freely is a page that leaves doors open.

const FULL = 'Three links are already out. Delete one to make room.'
const CAPTION = 'Each link lasts seven days. Seats are how many people it lets in.'
const NO_COPY = 'This browser would not copy it. Select the link and copy it by hand.'

const DAY = 24 * 60 * 60 * 1000

function expired(invite: AdminInvite): boolean {
  return invite.expires_at !== null && new Date(invite.expires_at).getTime() <= Date.now()
}

function open(invite: AdminInvite): boolean {
  return invite.used < invite.seats && !expired(invite)
}

// How long is left, in the words somebody would say it in. Rounded up, because
// "works for 6 more days" is what a link with five and a half days on it does.
function life(invite: AdminInvite): string {
  if (invite.expires_at === null) return 'Works until it is used'
  const days = Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / DAY)
  return days === 1 ? 'Works for 1 more day' : `Works for ${days} more days`
}

// The one line under the link: how many seats have gone, and what is left of
// it. A link that cannot let anybody else in says only why.
function state(invite: AdminInvite): string {
  if (invite.used >= invite.seats) {
    return invite.seats === 1 ? 'Used' : `All ${invite.seats} seats used`
  }
  if (expired(invite)) return 'Expired'
  return `${invite.used} of ${invite.seats} used · ${life(invite)}`
}

export function AdminInvites({ onBack }: { onBack: () => void }) {
  const [invites, setInvites] = useState<AdminInvite[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  const [seats, setSeats] = useState('1')
  // The link waiting on the question about deleting it.
  const [deleting, setDeleting] = useState<AdminInvite | null>(null)

  useTopBar({ title: 'Invites', back: { label: 'More', onBack } })

  // The guard says whether the screen is still there to take the answer.
  const load = (live: () => boolean = () => true) =>
    api<AdminInvite[]>('/admin/invites').then(
      (rows) => {
        if (live()) setInvites(rows)
      },
      (failure) => {
        if (!live()) return
        setError(errorText(failure))
        setInvites([])
      },
    )

  useEffect(() => {
    let alive = true
    void load(() => alive)
    return () => {
      alive = false
    }
  }, [])

  const mint = async () => {
    setBusy(true)
    setError('')
    try {
      // An empty field reads as zero, which the server answers in words.
      const count = Number.parseInt(seats, 10) || 0
      await api<AdminInvite>('/admin/invites', { method: 'POST', body: { seats: count } })
      await load()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const remove = async (code: string) => {
    setBusy(true)
    setError('')
    try {
      await api(`/admin/invites/${encodeURIComponent(code)}`, { method: 'DELETE' })
      await load()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const copy = async (link: string, code: string) => {
    setError('')
    try {
      await navigator.clipboard.writeText(link)
      setCopied(code)
    } catch {
      setError(NO_COPY)
    }
  }

  const rows = invites ?? []
  // Only the reader's own links count against the reader's allowance.
  const outstanding = rows.filter((invite) => invite.mine && open(invite)).length

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <div className="flex items-end gap-3">
          <div className="w-24 shrink-0">
            <label className="t-label" htmlFor="invite-seats">
              Seats
            </label>
            <input
              id="invite-seats"
              className="t-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              step={1}
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="t-btn t-btn-primary flex-1"
            disabled={busy || outstanding >= 3}
            onClick={mint}
          >
            New invite link
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{outstanding >= 3 ? FULL : CAPTION}</p>
      </div>

      {invites !== null && rows.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing here yet.</p>
        </div>
      )}

      {rows.map((invite) => {
        const link = `${window.location.origin}${invite.path}`
        const live = open(invite)
        return (
          <div key={invite.code} className="t-card mb-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm break-all">{live ? link : invite.code}</p>
              {live && (
                <button
                  type="button"
                  className="t-tap44 shrink-0 text-accent"
                  aria-label="Copy the link"
                  onClick={() => copy(link, invite.code)}
                >
                  <Copy className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {copied === invite.code ? 'Copied.' : state(invite)}
              </p>
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-danger"
                disabled={busy}
                onClick={() => setDeleting(invite)}
              >
                Delete
              </button>
            </div>
            {invite.members.length > 0 && (
              <p className="mt-1 text-xs">{invite.members.join(', ')}</p>
            )}
            {!invite.mine && <p className="mt-1 text-xs text-muted">From {invite.inviter}</p>}
          </div>
        )
      })}

      <ConfirmSheet
        open={deleting !== null}
        label="Delete invite link"
        question="Delete this invite link?"
        note={
          deleting !== null && deleting.used >= deleting.seats
            ? 'It has already been used; deleting it only tidies the list.'
            : 'Anyone holding it can no longer join.'
        }
        verb="Delete"
        busy={busy}
        onConfirm={() => {
          if (deleting === null) return
          const invite = deleting
          setDeleting(null)
          void remove(invite.code)
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  )
}
