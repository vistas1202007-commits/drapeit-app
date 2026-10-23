"""Very small in-memory rate limiter.

It remembers when each client made requests and refuses more than N per
minute. It resets when the server restarts, which is fine for local use. A
shared store (for example Redis) is needed once the app runs on many servers.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self.limit = limit_per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, cost: int = 1) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > 60:
                hits.popleft()
            if len(hits) + cost > self.limit:
                return False
            hits.extend([now] * cost)
            return True
