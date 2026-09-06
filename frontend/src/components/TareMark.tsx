import type { CSSProperties } from 'react'

// The mark: a balance scale whose post is a cross. It takes the text colour
// of wherever it sits, so one drawing serves both themes.
export function TareMark({
  className = 'h-5 w-5',
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={`shrink-0 ${className}`}
      style={style}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="450" y="60" width="100" height="780" rx="8" />
      <rect x="270" y="202" width="460" height="100" rx="10" />
      <rect x="128" y="232" width="744" height="40" rx="20" />
      <g fill="none" stroke="currentColor" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round">
        <path d="M200 286 L96 560 M200 286 L304 560" />
        <path d="M800 286 L696 560 M800 286 L904 560" />
      </g>
      <path d="M30 560 H370 A24 24 0 0 1 390 590 Q300 680 200 680 Q100 680 10 590 A24 24 0 0 1 30 560 Z" />
      <path d="M630 560 H970 A24 24 0 0 1 990 590 Q900 680 800 680 Q700 680 610 590 A24 24 0 0 1 630 560 Z" />
      <path d="M350 860 Q350 800 410 800 H590 Q650 800 650 860 V905 Q650 925 630 925 H370 Q350 925 350 905 Z" />
    </svg>
  )
}
