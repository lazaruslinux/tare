import { TareMark } from './TareMark'

// Zen Dots capitals stand 0.715 em tall, so this is the font size at which
// the letters are exactly as tall as the mark.
const CAP = 0.715

// The mark and the name together, in the accent colour, the letters as tall
// as the mark. One number sizes both.
export function TareWordmark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center text-accent ${className}`} style={{ gap: size * 0.45 }}>
      <TareMark className="" style={{ height: size, width: size }} />
      <span className="t-wordmark" style={{ fontSize: size / CAP }}>
        Tare
      </span>
    </span>
  )
}
