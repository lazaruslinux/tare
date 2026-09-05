// One day by the hour: twenty-four thin bars standing on the faint lines that
// divide the hours, with a clock face under them.
//
// The lines are the picture as much as the bars are. A day with two busy hours
// is mostly empty, and an empty chart that still shows where the hours are
// reads as a quiet day rather than as a box with nothing in it.

// How wide one hour is in the drawing, and how wide the bar standing in it is.
// The bar is centred in its hour, which leaves the same gap either side.
const PITCH = 12
const BAR = 4
const PLOT_W = 24 * PITCH
const PLOT_H = 64
// Headroom over the tallest bar, so the busiest hour does not touch the top.
const BAR_H = 62

// The clock face under the bars: four words at the quarters of the day.
const MARKS = [
  { at: 0, text: '12 AM' },
  { at: 25, text: '6 AM' },
  { at: 50, text: '12 PM' },
  { at: 75, text: '6 PM' },
]

// The hour a bar stands for, said the way a clock face says it.
const hourTitle = (hour: number): string =>
  `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'am' : 'pm'}`

// What one bar is worth, in the words the card is read in. A distance is the
// one reading small enough in an hour to be worth decimals, and it takes the
// two a watch prints. Steps and calories are whole.
const barText = (value: number, unit: string): string => {
  const said =
    unit === 'mi' || unit === 'km'
      ? value.toFixed(2)
      : Math.round(value).toLocaleString()
  return unit === '' ? said : `${said} ${unit}`
}

export function HourBars({
  hours,
  color,
  label,
  unit,
  // Taller on a wide screen, for a card that is the only thing in its row.
  tall = false,
}: {
  // Twenty-four slots, empty where nothing landed. Already in the unit below:
  // a distance is converted before it arrives here.
  hours: (number | null)[]
  // The CSS variable the bars are drawn in, such as "var(--violet)".
  color: string
  label: string
  unit: string
  tall?: boolean
}) {
  const highest = Math.max(...hours.map((value) => value ?? 0), 1)
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        className={`w-full h-16 ${tall ? 'min-[900px]:h-20' : ''}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {Array.from({ length: 25 }, (_, hour) => (
          <line
            key={`hour-${hour}`}
            className="t-stroke"
            x1={hour * PITCH}
            y1={0}
            x2={hour * PITCH}
            y2={PLOT_H}
            stroke="var(--line)"
            strokeWidth={1}
          />
        ))}
        <line
          className="t-stroke"
          x1={0}
          y1={PLOT_H - 0.5}
          x2={PLOT_W}
          y2={PLOT_H - 0.5}
          stroke="var(--line)"
          strokeWidth={1}
        />
        {hours.map((value, hour) => {
          if (value === null) return null
          const height = Math.max((value / highest) * BAR_H, 1)
          return (
            <rect
              key={hour}
              x={hour * PITCH + (PITCH - BAR) / 2}
              y={PLOT_H - height}
              width={BAR}
              height={height}
              rx={1}
              fill={color}
            >
              <title>{`${hourTitle(hour)}: ${barText(value, unit)}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="relative h-4">
        {MARKS.map((mark) => (
          <span
            key={mark.text}
            className="absolute top-0 block text-[10px] leading-3 text-muted"
            style={{ left: `${mark.at}%` }}
          >
            <span className="block h-1 w-px bg-line-strong" />
            {mark.text}
          </span>
        ))}
      </div>
    </div>
  )
}
