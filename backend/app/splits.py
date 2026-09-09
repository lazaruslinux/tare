"""The splits of a session, worked out where the sharing rules are.

A split used to be worked out on the phone that drew it, which meant every
minute of a session had to be sent before the table could be drawn. A member
who shares their splits and not their minutes is asking for exactly the one
without the other, so the arithmetic moved here.

The minutes are added up rather than read as a running total, because a row is
a wall-clock minute and the session's own duration leaves out the minutes it
paused for without saying which ones. A minute that carries a boundary is
divided at it, in the proportion its distance was, which is the best a
per-minute export can say about where a mile ended.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import TypedDict

from app import models

# A phone writes one row a minute and numbers the rows from the start, so a
# minute is the whole of the timing there is to work from.
MINUTE_S = 60.0

# One mile in the metres everything is stored in.
M_PER_MILE = 1609.344


class Split(TypedDict):
    """One whole mile or kilometre of a session, and what it took."""

    # 1 for the first, 2 for the second, and so on.
    index: int
    distance_m: float
    # Kept unrounded, so the splits of a session still add up to it.
    seconds: float
    # What the bars are scaled on and what the quickest one is picked by: fewer
    # seconds is quicker, whichever way the pace is written.
    pace_s_per_unit: float
    # The average of whatever heart rate readings landed inside it, or none.
    hr: int | None
    # Whether it is a whole one. The last split of a session usually is not.
    whole: bool


def step_of(units: str) -> float:
    """One mile or one kilometre, by what the reader reads in."""
    return 1000.0 if units == "metric" else M_PER_MILE


def distance_in(metres: float, units: str) -> float:
    return metres / 1000.0 if units == "metric" else metres / M_PER_MILE


def _moved(row: models.WorkoutSample) -> bool:
    return (row.distance_m or 0) > 0 or (row.steps or 0) > 0


def _hr_of(row: models.WorkoutSample) -> int | None:
    """The beat a minute is counted at: the average, or the best there is."""
    if row.hr_avg is not None:
        return row.hr_avg
    return row.hr_max if row.hr_max is not None else row.hr_min


def _split(
    index: int,
    distance: float,
    seconds: float,
    beats: float,
    beat_seconds: float,
    whole: bool,
    units: str,
) -> Split:
    covered = distance_in(distance, units)
    return {
        "index": index,
        "distance_m": distance,
        "seconds": seconds,
        "pace_s_per_unit": seconds / covered if covered > 0 else 0.0,
        # Rounded the way a screen rounds, half away from zero.
        "hr": math.floor(beats / beat_seconds + 0.5) if beat_seconds > 0 else None,
        "whole": whole,
    }


def splits_of(samples: Sequence[models.WorkoutSample], units: str) -> list[Split]:
    """Every whole mile or kilometre of a session, and the tail it ended on."""
    step = step_of(units)
    moving = [row for row in samples if _moved(row)]
    last_moving = moving[-1] if moving else None
    before_last = moving[-2] if len(moving) > 1 else None
    splits: list[Split] = []
    covered = 0.0
    seconds = 0.0
    beats = 0.0
    beat_seconds = 0.0

    for row in samples:
        left = max(0.0, row.distance_m or 0.0)
        # A minute that recorded movement counts whole; one that recorded none
        # adds nothing, being a pause or a reading stamped after the finish.
        time = MINUTE_S if _moved(row) else 0.0
        # A session rarely ends on the stroke of a minute, so the last moving
        # one takes the share its distance suggests against the minute before.
        if (
            row is last_moving
            and before_last is not None
            and (before_last.distance_m or 0) > 0
        ):
            time = min(MINUTE_S, MINUTE_S * (left / (before_last.distance_m or 1)))
        hr = _hr_of(row)

        while left > 0 and covered + left >= step:
            part = step - covered
            took = time * (part / left)
            seconds += took
            if hr is not None:
                beats += hr * took
                beat_seconds += took
            splits.append(
                _split(len(splits) + 1, step, seconds, beats, beat_seconds, True, units)
            )
            covered = 0.0
            seconds = 0.0
            beats = 0.0
            beat_seconds = 0.0
            left -= part
            time -= took

        covered += left
        seconds += time
        if hr is not None:
            beats += hr * time
            beat_seconds += time

    # Whatever the session ended part way through, at the distance it actually
    # reached rather than rounded up to a mile nobody ran. A tail shorter than a
    # hundredth of a unit is left off: it is the smallest thing the row could
    # print, and a split reading 0.00 is not a split.
    if covered >= step / 100 and seconds > 0:
        splits.append(
            _split(len(splits) + 1, covered, seconds, beats, beat_seconds, False, units)
        )
    return splits


def fastest_of(splits: Sequence[Split]) -> int | None:
    """Which whole split was quickest, by its index, or none.

    The tail is never it: a finish two tenths long is quicker per mile than any
    mile of the session on most runs, and calling that the fastest mile would
    name a mile nobody ran. One split on its own is not a comparison either.
    """
    whole = [split for split in splits if split["whole"]]
    if len(whole) < 2:
        return None
    best = min(whole, key=lambda split: split["pace_s_per_unit"])
    return best["index"]
