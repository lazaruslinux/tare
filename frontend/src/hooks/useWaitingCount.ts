import { useCallback, useEffect, useState } from 'react'

import { api, type Me, type MySubmission, type QueueItem } from '../api'

// What the badge counts, read once for the three places that say so: the More
// tab, the rail's More row, and the row that opens the queue. Everybody counts
// the answers they have been given and not yet read; an administrator counts
// the queue as well, because both are things waiting on them. Null is nobody
// signed in, which the shell holds for the moment before the account has been
// read.
export function useWaitingCount(me: Me | null): {
  waiting: number
  queue: number
  refresh: () => void
} {
  const [waiting, setWaiting] = useState(0)
  // The queue on its own, for the row that opens it. The badge is the sum; the
  // row is about the queue and says only what is in it.
  const [queue, setQueue] = useState(0)
  const [again, setAgain] = useState(0)

  useEffect(() => {
    if (me === null) return
    let alive = true
    const mine = api<MySubmission[]>('/submissions/mine')
      .then((rows) => rows.filter((row) => row.status !== 'pending' && row.seen_at === null).length)
      .catch(() => 0)
    const reviewing = me.is_admin
      ? api<QueueItem[]>('/admin/queue')
          .then((rows) => rows.length)
          .catch(() => 0)
      : Promise.resolve(0)
    void Promise.all([mine, reviewing]).then(([unread, review]) => {
      if (!alive) return
      setWaiting(unread + review)
      setQueue(review)
    })
    return () => {
      alive = false
    }
  }, [me, again])

  const refresh = useCallback(() => setAgain((count) => count + 1), [])
  return { waiting, queue, refresh }
}
