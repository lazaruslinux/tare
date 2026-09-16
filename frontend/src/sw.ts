/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// The worker behind the installed app. It holds the build so the app opens
// without a network, answers the Reload bar, and draws the notifications the
// server sends. Written by hand rather than generated, because the last two
// are not something a generator offers.

declare let self: ServiceWorkerGlobalScope

// The build's own files, listed by the plugin at build time.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Every navigation is the app, except the api, which is never answered from a
// cache: a cached reading would be yesterday's.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }))

// The Reload bar's message: the waiting build takes over now.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') void self.skipWaiting()
})

// What the server sends. Encrypted on the way here, so nothing but this
// worker and the person holding the phone ever reads it.
type Payload = { title: string; body: string; url: string; tag: string }

self.addEventListener('push', (event) => {
  if (event.data === null) return
  let payload: Payload
  try {
    payload = event.data.json() as Payload
  } catch {
    return
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: '/icon-192.png',
      data: { url: payload.url },
    })
  )
})

// A tap on the banner. An app that is already open is brought forward and
// told where to go; otherwise the address opens a window of its own.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const client = open.find((each) => each.visibilityState === 'visible') ?? open[0]
      if (client !== undefined) {
        try {
          await client.focus()
        } catch {
          // iOS may refuse to focus; the message below still lands.
        }
        client.postMessage({ type: 'open', url })
        return
      }
      await self.clients.openWindow(url)
    })()
  )
})
