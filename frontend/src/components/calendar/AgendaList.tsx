import type { Occurrence } from '../../api'
import { dateText, type Clock } from '../../lib/clock'
import { formatTime } from '../../lib/calendar'
import { tintOf } from './DayTimeline'

// One day's entries as a list, under the month grid at any width the month
// has the page to itself, and in the right-hand column where there is one.

export function AgendaList({
  dateIso,
  items,
  clock,
  onOpen,
}: {
  dateIso: string
  items: Occurrence[]
  clock: Clock
  onOpen: (item: Occurrence) => void
}) {
  return (
    <div>
      <p className="t-micro mb-1">{dateText(dateIso)}</p>
      <div className="t-cal-agenda">
        {items.length === 0 ? (
          <p className="py-3 text-sm text-muted">Nothing scheduled.</p>
        ) : (
          items.map((item) => (
            <button
              key={`${item.id}-${item.occurrence_date}`}
              type="button"
              className="t-row w-full text-left"
              onClick={() => onOpen(item)}
            >
              <span className="t-nums w-20 shrink-0 text-xs text-muted">
                {item.all_day || item.start === null ? 'All day' : formatTime(item.start, clock)}
              </span>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: tintOf(item) }}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    item.cancelled ? 'text-muted line-through' : ''
                  }`}
                >
                  {item.title}
                </span>
                {(item.calendars.length > 0 || !item.mine) && (
                  <span className="block truncate text-xs text-muted">
                    {[
                      ...item.calendars.map((shelf) => shelf.name),
                      ...(item.mine ? [] : [item.owner.display_name]),
                    ].join(' · ')}
                  </span>
                )}
              </span>
              {item.cancelled && <span className="t-chip shrink-0">Cancelled</span>}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
