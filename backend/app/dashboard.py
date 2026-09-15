"""Which units the Dashboard shows, and the order they are read in.

One list per account rather than one setting per card, because the order is
part of the answer. Everything stored is read back through normalize, so a
card added later turns up on an old list and a name Tare no longer has falls
off one.
"""

from __future__ import annotations

from typing import Any

# The five units of the Dashboard, in the order a new account reads them.
KEYS = ("numbers", "calendar", "food_activity", "progress", "community")

BAD_CARD = "That is not a Dashboard card."


def default() -> list[dict[str, Any]]:
    """Every card, in Tare's own order, all shown."""
    return [{"key": key, "shown": True} for key in KEYS]


def normalize(cards: Any) -> list[dict[str, Any]]:
    """Known keys only and each of them once, the first mention winning, with
    anything missing appended shown. An empty list comes back as the default."""
    arranged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for card in cards or []:
        if not isinstance(card, dict):
            continue
        key = card.get("key")
        if not isinstance(key, str) or key not in KEYS or key in seen:
            continue
        seen.add(key)
        arranged.append({"key": key, "shown": bool(card.get("shown", True))})
    arranged.extend({"key": key, "shown": True} for key in KEYS if key not in seen)
    return arranged
