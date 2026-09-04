import { Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, errorText, type AdminInvite } from '../api'
import { useTopBar } from '../hooks/useTopBar'

// The links that let somebody in. Three at a time on purpose: an unclaimed
// link is a way into the instance, and a page that mints them freely is a page
// that leaves doors open.

const FULL = 'Three links are already out. Revoke one to make room.'
const NO_COPY = 'This browser would not copy it. Select the link and copy it by hand.'

const DAY = 24 * 60 * 60 * 1000

function open(invite: AdminInvite): boolean {
  if (invite.used_by !== null) return false
  return invite.expires_at === null || new Date(invite.expires_at).getTime() > Date.now()
}

// How long is left, in the words somebody would say it in. Rounded up, because
// "works for 6 more days" is what a link with five and a half days on it does.
function life(invite: AdminInvite): string {
  if (invite.used_by !== null) return `Used by ${invite.used_by}`
  if (invite.expires_at === null) return 'Works until it is used'
  const days = Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / DAY)
  if (days <= 0) return 'Expired'
  return days === 1 ? 'Works for 1 more day' : `Works for ${days} more days`
}

export function AdminInvites({ onBack }: { onBack: () => void }) {
  const [invites, setInvites] = useState<AdminInvite[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
  // The link a second tap would revoke. Asking twice rather than opening a
  // dialogue: the answer is one word and the row is already on screen.
  const [sure, setSure] = useState('')

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
      await api<AdminInvite>('/admin/invites', { method: 'POST', body: {} })
      await load()
    } catch (failure) {
      setError(errorText(failure))
    }
    setBusy(false)
  }

  const revoke = async (code: string) => {
    setBusy(true)
    setError('')
    setSure('')
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
  const outstanding = rows.filter(open).length

  return (
    <>

      {error && <p className="t-error mb-3">{error}</p>}

      <div className="t-card mb-3">
        <button
          type="button"
          className="t-btn t-btn-primary w-full"
          disabled={busy || outstanding >= 3}
          onClick={mint}
        >
          New invite link
        </button>
        <p className="mt-2 text-xs text-muted">
          {outstanding >= 3 ? FULL : 'Each link lets one person in and lasts seven days.'}
        </p>
      </div>

      {invites !== null && rows.length === 0 && (
        <div className="t-card mb-3">
          <p className="text-sm text-muted">Nothing here yet.</p>
        </div>
      )}

      {rows.map((invite) => {
        const link = `${window.location.origin}${invite.path}`
        return (
          <div key={invite.code} className="t-card mb-3">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm break-all">
                {open(invite) ? link : invite.code}
              </p>
              {open(invite) && (
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
                {copied === invite.code ? 'Copied.' : life(invite)}
              </p>
              {invite.used_by === null && (
                <button
                  type="button"
                  className="shrink-0 text-sm font-semibold text-danger"
                  disabled={busy}
                  onClick={() => (sure === invite.code ? revoke(invite.code) : setSure(invite.code))}
                >
                  {sure === invite.code ? 'Sure?' : 'Revoke'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
