// What address the app was opened on, read once on the way in.
//
// There is no router here and there does not need to be: the app is one screen
// with tabs, and three addresses arrive from outside it, all by email or by a
// link somebody was sent. The fourth comes from inside: a link back through
// setup. Reading them at import rather than in a component means it happens
// once whatever React does with renders.

export type Entry =
  | { kind: 'app' }
  | { kind: 'welcome'; code: string }
  | { kind: 'verify'; token: string }
  | { kind: 'reset'; token: string }
  | { kind: 'setup' }
  | { kind: 'tour' }

function read(): Entry {
  const path = window.location.pathname
  const welcome = /^\/welcome\/([^/]+)\/?$/.exec(path)
  if (welcome) return { kind: 'welcome', code: decodeURIComponent(welcome[1]) }
  if (path === '/verify-email') {
    return { kind: 'verify', token: new URLSearchParams(window.location.search).get('token') ?? '' }
  }
  if (path === '/reset-password') {
    return { kind: 'reset', token: new URLSearchParams(window.location.search).get('token') ?? '' }
  }
  // Walking the setup steps again. It carries nothing but the request.
  if (path === '/' && new URLSearchParams(window.location.search).has('setup')) {
    return { kind: 'setup' }
  }
  // Taking the welcome tour again, whatever the account has already seen.
  if (path === '/' && new URLSearchParams(window.location.search).has('tour')) {
    return { kind: 'tour' }
  }
  return { kind: 'app' }
}

export const entry: Entry = read()

if (entry.kind !== 'app') {
  // Put the address back to the root now that it has been read. A reload
  // should land on the app rather than replay a link that has been spent, and
  // an emailed token has no business sitting in the address bar to be copied
  // out of it.
  window.history.replaceState(null, '', '/')
}
