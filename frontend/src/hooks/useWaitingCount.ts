import { useCallback, useEffect, useState } from 'react'

import { api, type FriendsPage, type Me, type MySubmission, type QueueItem } from '../api'
import { reviews } from '../lib/roles'

// What the badge counts, read once for the three places that say so: the More
// tab, the rail's More row, and the row that opens the queue. Everybody counts
// the answers they have been given and not yet read and the friend requests
// nobody has answered; anybody with a role counts the queue as well, because
// all of them are things waiting on them. Null is nobody signed in, which the
// shell holds for the moment before the account has been read.
export function useWaitingCount(me: Me | null): {
  waiting: number
  queue: number
  requests: number
  refresh: () => void
} {
  const [waiting, setWaiting] = useState(0)
  // The queue on its own, for the row that opens it. The badge is the sum; the
  // row is about the queue and says only what is in it.
  const [queue, setQueue] = useState(0)
  // The same for requests, which the Members row says under itself.
  const [requests, setRequests] = useState(0)
  const [again, setAgain] = useState(0)

  useEffect(() => {
    if (me === null) return
    let alive = true
    const mine = api<MySubmission[]>('/submissions/mine')
      .then((rows) => rows.filter((row) => row.status !== 'pending' && row.seen_at === null).length)
      .catch(() => 0)
    const reviewing = reviews(me)
      ? api<QueueItem[]>('/admin/queue')
          .then((rows) => rows.length)
          .catch(() => 0)
      : Promise.resolve(0)
    const asking = api<FriendsPage>('/feed/friends')
      .then((page) => page.incoming.length)
      .catch(() => 0)
    void Promise.all([mine, reviewing, asking]).then(([unread, review, asked]) => {
      if (!alive) return
      setWaiting(unread + review + asked)
      setQueue(review)
      setRequests(asked)
    })
    return () => {
      alive = false
    }
  }, [me, again])

  const refresh = useCallback(() => setAgain((count) => count + 1), [])
  return { waiting, queue, requests, refresh }
}
