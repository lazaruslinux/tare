// The browser side of turning notifications on. Everything that touches the
// permission or the push service lives here, so the one screen that asks is
// the only caller and nothing else can prompt by accident.

export type PushSupport = 'unsupported' | 'needs-install' | 'blocked' | 'off'

// Whether the app is running from the Home Screen rather than in a tab. Safari
// answers the old property; everything else answers the display mode.
function installed(): boolean {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return legacy || window.matchMedia('(display-mode: standalone)').matches
}

// An iPad on a recent iPadOS says it is a Mac, and the touch count is the only
// thing that gives it away.
function apple(): boolean {
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true
  return navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1
}

export function support(): PushSupport {
  // Apple first: Safari in a tab has no PushManager at all, so the capability
  // check below would call an iPhone unsupported when what it needs is the
  // Home Screen.
  if (apple() && !installed()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return 'off'
}

// The server's public key, as the subscribe call wants it. The buffer is
// named so the bytes are the plain kind the call takes, not a shared one.
export function urlBase64ToUint8Array(key: string): Uint8Array<ArrayBuffer> {
  const padded = key.padEnd(key.length + ((4 - (key.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  return bytes
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

// Asked from inside the tap that asked for it: every browser refuses a
// permission prompt that did not come from one.
export async function subscribe(publicKey: string): Promise<PushSubscriptionJSON> {
  const answer = await Notification.requestPermission()
  if (answer !== 'granted') throw new Error('blocked')
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  return subscription.toJSON()
}

// What was turned off, so the row holding that address can go with it.
export async function unsubscribe(): Promise<string | null> {
  const subscription = await currentSubscription()
  if (subscription === null) return null
  const { endpoint } = subscription
  await subscription.unsubscribe()
  return endpoint
}
