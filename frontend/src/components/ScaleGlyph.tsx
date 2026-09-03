// A bathroom scale, drawn here because lucide has no such icon: its Scale is a
// balance and its Weight is a kettlebell. Same 24 grid, 2px stroke, round caps
// and currentColor as the lucide glyphs it sits beside.
export function ScaleGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M7 11.5a5 5 0 0 1 10 0" />
      <path d="M7 11.5h10" />
      <path d="m12 11.5 2.5-3" />
      <path d="M8 17h8" />
    </svg>
  )
}
