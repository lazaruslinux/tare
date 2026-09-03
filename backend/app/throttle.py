"""Sliding-window attempt counting, kept in memory and keyed per address.

One process, one dictionary. That is the honest scope of it: an instance run
behind more than one worker counts each worker's share separately, which loosens
every allowance below by that factor rather than breaking anything. The stack
ships a single worker, and a shared store is the thing to add if that changes.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from collections import defaultdict, deque

from fastapi import Request

from app.config import settings

log = logging.getLogger("tare.throttle")

# The one wording every limiter answers with, so somebody asked to wait is
# asked the same way wherever they were typing.
TOO_MANY = "Too many attempts just now. Wait a few minutes and try again."

# Except the one that counts by the hour, which has to name the hour or it
# reads as a wait of a few minutes that never ends.
TOO_MANY_UPLOADS = "Too many uploads. Try again in an hour."

# Sweep only once the table is larger than any real audience, so an ordinary
# instance never pays for the sweep at all.
_SWEEP_THRESHOLD = 2048
# A hard ceiling, in case keys arrive faster than the sweep clears them.
_MAX_TRACKED = 20000

# Every limiter ever built, so reset_limiters cannot miss one. A hand-kept list
# is exactly how a new limiter ends up outside it and produces the test that
# passes alone and fails in the suite.
_ALL_LIMITERS: list[RateLimiter] = []


class RateLimiter:
    """Attempt counting per key over a sliding window.

    One instance per thing being limited, so guessing passwords cannot eat the
    allowance that protects anything else.

    The sweep is not incidental: a bare dictionary of keys grows a permanent
    entry for every key it ever sees. The timestamps inside age out, the entry
    does not. That is a slow leak under ordinary traffic and a deliberate one
    under attack.
    """

    def __init__(self, max_attempts: int, window_seconds: int, name: str) -> None:
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self.name = name
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)
        _ALL_LIMITERS.append(self)

    def _sweep(self, now: float) -> None:
        stale = [
            key
            for key, hits in self._hits.items()
            if not hits or now - hits[-1] > self.window_seconds
        ]
        for key in stale:
            del self._hits[key]

    def _evict_oldest(self) -> None:
        """Drop whichever key has gone longest without a hit.

        Refusing new keys instead would be the wrong answer: an address-keyed
        limiter reaching its ceiling means somebody is flooding it with spoofed
        addresses, and the refusal would then lock every real person out of the
        endpoint the flood is aimed at.
        """
        oldest = min(self._hits, key=lambda key: self._hits[key][-1] if self._hits[key] else 0.0)
        del self._hits[oldest]

    def hit(self, key: str) -> bool:
        """Record an attempt. True means this one should be refused."""
        now = time.time()
        if len(self._hits) >= _SWEEP_THRESHOLD:
            self._sweep(now)
        if key not in self._hits and len(self._hits) >= _MAX_TRACKED:
            log.warning("%s limiter is at its ceiling; evicting the oldest key", self.name)
            self._evict_oldest()
        history = self._hits[key]
        while history and now - history[0] > self.window_seconds:
            history.popleft()
        if len(history) >= self.max_attempts:
            return True
        history.append(now)
        return False

    def clear(self) -> None:
        self._hits.clear()


# Guessing a password. The one an attacker actually wants, so it is the
# tightest of the three that a person meets in normal use; twenty in five
# minutes is well past anybody typing badly and nowhere near a guessing run.
login_limiter = RateLimiter(20, 300, "login")
# Spending an invite code. Lower, because a code is guessable in principle and
# registration is the other way into an account.
register_limiter = RateLimiter(10, 300, "register")
# Opening an invite link. Unauthenticated, and as roomy as login: somebody
# opens a link and reloads it a few times, and the codes are high entropy, so
# this is a guard against a loop rather than against walking the code space.
welcome_limiter = RateLimiter(20, 300, "welcome")
# Asking for another verification mail. Far tighter, and over a longer window,
# because every accepted call sends a message to an address somebody typed in,
# and a form that mails a stranger on demand is a way to use this server to
# bother them.
resend_limiter = RateLimiter(3, 900, "resend")
# Asking for a password reset link. Shaped like the resend above, and a little
# roomier because the address is typed in rather than read off the account: the
# same person mistyping it twice should not be locked out of their own reset.
forgot_limiter = RateLimiter(5, 900, "forgot")
# Posting a health export. Keyed by address and counted before the token is
# looked at, so guessing tokens spends the same allowance as anything else from
# that address. Sixty a minute is far past what a phone automation does and far
# under what a guessing run needs.
ingest_limiter = RateLimiter(60, 60, "ingest")
# Handing over a health export as a file, counted per account rather than per
# address. Five an hour is more than anybody moving their history in needs, and
# it is what stops one signed-in member asking this server to parse a large
# file over and over.
upload_limiter = RateLimiter(5, 3600, "upload")
# Minting a sync key. Tight because each call replaces the standing key, and a
# member who has just replaced theirs has no reason to do it again this minute.
ingest_token_limiter = RateLimiter(5, 60, "ingest-token")


def reset_limiters() -> None:
    """Clear every limiter. The tests share one process, and state carried
    between cases makes them order dependent."""
    for limiter in _ALL_LIMITERS:
        limiter.clear()


def client_address(request: Request) -> str:
    """The caller's address, read from the right of X-Forwarded-For.

    That header is a list the caller gets to start writing, and a proxy appends
    what it saw rather than replacing what arrived: a request sent with
    "X-Forwarded-For: 1.2.3.4" reaches us as "1.2.3.4, <real caller>". Reading
    from the left reads the value the caller chose, which lets anyone pick
    their own bucket and walk past the limiter. The right-most entries are the
    ones our own proxies wrote.

    trusted_proxy_hops says how many of those there are. Setting it higher than
    the number really in front hands the choice of bucket back to the caller,
    which is the hole this exists to close.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    entries = [part.strip() for part in reversed(forwarded.split(","))]
    # Clamped, so a header shorter than the configured hop count falls through
    # to the connection address rather than reading past the end of the list.
    hops = min(max(settings.trusted_proxy_hops, 0), len(entries))
    for entry in entries[hops:]:
        if not entry:
            continue
        try:
            ipaddress.ip_address(entry)
        except ValueError:
            # A proxy writes a bare address. Anything else did not come from
            # ours, so stop rather than reading further left into whatever the
            # caller supplied.
            break
        return entry
    return request.client.host if request.client else "unknown"
