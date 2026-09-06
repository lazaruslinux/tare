import { TareMark } from './TareMark'

// Zen Dots capitals stand 0.715 em tall, so this is the font size at which
// the letters are exactly as tall as the mark.
const CAP = 0.715

// The mark and the name together, in the accent colour. One number sizes
// both: the letters stand `size` tall and the mark stands as tall as the
// font itself, a little above and below them.
export function TareWordmark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center text-accent ${className}`} style={{ gap: size * 0.45 }}>
      <TareMark className="" style={{ height: size / CAP, width: size / CAP }} />
      <span className="t-wordmark" style={{ fontSize: size / CAP }}>
        Tare
      </span>
    </span>
  )
}
