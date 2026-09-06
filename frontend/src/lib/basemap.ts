// Whether this instance has the optional tiles archive installed, asked once a
// session with a request for a single byte.
//
// Nothing here imports the map. The answer is settled before anything decides
// to fetch a renderer the size of maplibre, so an instance that skipped the
// archive never downloads that chunk at all and the route still draws as a
// line.

// The archive, and the folder of lettering and symbols beside it. Both come out
// of the same mounted folder, so an instance either has all of it or none.
export const TILES = '/tiles/basemap.pmtiles'
export const ASSETS = '/tiles/basemap'

let asked: Promise<boolean> | undefined

export function basemapInstalled(): Promise<boolean> {
  asked ??= fetch(TILES, { headers: { Range: 'bytes=0-0' } })
    .then((answer) => {
      // A server that honours the range sends 206 and the one byte asked for.
      // One that ignores it answers 200 and starts sending the whole archive,
      // which is dropped on the spot rather than pulled down.
      if (answer.status === 200) void answer.body?.cancel()
      return answer.status === 200 || answer.status === 206
    })
    .catch(() => false)
  return asked
}

let drawable: boolean | undefined

// Whether this browser can hand out a WebGL context at all. A renderer throws
// from its own constructor where it cannot, and the throw lands in the root
// boundary, so the answer is settled here first and kept for the session.
export function canDrawMaps(): boolean {
  if (drawable !== undefined) return drawable
  drawable = false
  try {
    const canvas = document.createElement('canvas')
    drawable = canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null
  } catch {
    drawable = false
  }
  return drawable
}
