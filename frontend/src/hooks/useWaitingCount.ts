import { useCallback, useEffect, useState } from 'react'

import { api, type Me, type QueueItem } from '../api'

// How many submissions are waiting, read once for the two places that say so:
// the gear in the top bar and the row that opens the queue. Nobody but an
// administrator has the route, so nobody else asks. Null is nobody signed in,
// which the shell holds for the moment before the account has been read.
export function useWaitingCount(me: Me | null): { waiting: number; refresh: () => void } {
  const [waiting, setWaiting] = useState(0)
  const [again, setAgain] = useState(0)

  useEffect(() => {
    if (!me?.is_admin) return
    let alive = true
    api<QueueItem[]>('/admin/queue')
      .then((rows) => alive && setWaiting(rows.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [me?.is_admin, again])

  const refresh = useCallback(() => setAgain((count) => count + 1), [])
  return { waiting, refresh }
}
