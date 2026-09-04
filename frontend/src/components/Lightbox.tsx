import { useEffect } from 'react'

// One picture, as big as the screen allows, over everything. A tap anywhere
// or Escape puts it away. Pinch zoom is the browser's own, so nothing here
// has to pretend to be a photo viewer.
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <button
      type="button"
      aria-label="Close the picture"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <img src={src} alt={alt} className="max-h-full max-w-full rounded-xl" />
    </button>
  )
}
