import { useEffect, useRef, useState } from 'react'

import { api, type Me, type MySubmission } from '../api'
import { useTopBar } from '../hooks/useTopBar'
import { dayLabel, dayOf, today } from '../lib/day'
import { KIND_LABEL, changeLine, statusLabel } from '../lib/community'

// Everything this account has offered the shared database, in one place. The
// Food tab is about foods; this is about the answers to them, so it is a
// screen of its own rather than a card wedged in beside the lists.

// How long something taken back can be put back. Short enough that nobody is
// waiting on it, long enough to notice the mistake.
const UNDO = 6000

// Something taken off the screen that has not been sent yet. The request goes
// when the window closes, so undoing is not a second write to put back what a
// first one destroyed.
type Undo = { message: string; commit: () => void }

export function Submissions({
  me,
  refresh,
  onBack,
  onOpenFood,
  onSeen,
  onChanged,
}: {
  me: Me
  // The app-wide change tick. Every bump reads the list again, quietly: the
  // rows on screen stay up while the request is out.
  refresh: number
  onBack: () => void
  // The food a row is about, opened on the tab it lives on.
  onOpenFood: (foodId: number) => void
  // The answers on this screen have been read, so the badge that counted them
  // is worth asking again.
  onSeen: () => void
  // Something here changed on the server, and the other tabs list it too.
  onChanged: () => void
}) {
  // Null until the first read answers, which is the difference between a list
  // with nothing in it and a list nobody has been given yet.
  const [rows, setRows] = useState<MySubmission[] | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const undoRef = useRef<Undo | null>(null)

  useTopBar({ title: 'My submissions', back: { label: 'More', onBack } })

  const load = () =>
    api<MySubmission[]>('/submissions/mine').then(setRows, () => setRows((held) => held ?? []))

  useEffect(() => {
    let alive = true
    api<MySubmission[]>('/submissions/mine')
      .then((loaded) => alive && setRows(loaded))
      .catch(() => alive && setRows((held) => held ?? []))
    return () => {
      alive = false
    }
  }, [refresh])

  const settle = () => {
    const waiting = undoRef.current
    undoRef.current = null
    waiting?.commit()
  }

  // A second withdrawal inside the window settles the first rather than
  // replacing it, so nothing leaves the screen without reaching the server.
  const hold = (waiting: Undo) => {
    settle()
    undoRef.current = waiting
    setUndo(waiting)
  }

  useEffect(() => {
    if (undo === null) return
    const timer = window.setTimeout(() => {
      settle()
      setUndo(null)
    }, UNDO)
    return () => window.clearTimeout(timer)
  }, [undo])

  // Leaving the screen is the window closing. Anything still waiting is settled
  // on the way out rather than quietly forgotten.
  useEffect(() => () => settle(), [])

  // This screen lists the answers, so reading it is reading them. Once per set
  // of unread ones, and the badge is asked again after.
  const unread = (rows ?? []).some((row) => row.status !== 'pending' && row.seen_at === null)
  useEffect(() => {
    if (!unread) return
    api('/submissions/seen', { method: 'POST' })
      .then(() => {
        onSeen()
        return api<MySubmission[]>('/submissions/mine')
      })
      .then(setRows)
      .catch(() => {})
  }, [unread, onSeen])

  const withdraw = (submission: MySubmission) => {
    setRows((held) => (held ?? []).filter((row) => row.id !== submission.id))
    hold({
      message: `Took back ${submission.name ?? 'that submission'}.`,
      commit: () => {
        api(`/submissions/${submission.id}`, { method: 'DELETE' })
          .then(() => onChanged())
          .catch(() => {})
      },
    })
  }

  const putBack = () => {
    undoRef.current = null
    setUndo(null)
    void load()
  }

  // Newest first, sorted here rather than trusted to whichever request last
  // filled the list.
  const sent = [...(rows ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  return (
    <>
      <div className="t-card mb-3">
        {rows === null ? (
          <p className="text-sm text-muted">Loading.</p>
        ) : sent.length === 0 ? (
          <p className="text-sm text-muted">
            Foods you submit to the Tare database show up here.
          </p>
        ) : (
          sent.map((row) => {
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
                    onClick={() => onOpenFood(foodId)}
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
