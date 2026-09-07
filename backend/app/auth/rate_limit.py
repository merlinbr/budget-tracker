from collections import OrderedDict, deque
from dataclasses import dataclass, field
import math
import threading
import time
from collections.abc import Callable


@dataclass
class _Bucket:
    failures: deque[float] = field(default_factory=deque)
    in_flight: int = 0
    generation: int = 0
    last_activity: float = 0.0


@dataclass(frozen=True)
class RateLimitTicket:
    username: str
    ip: str
    username_generation: int
    ip_generation: int


class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("Too many requests.")
        self.retry_after = retry_after


class LoginRateLimiter:
    def __init__(
        self,
        *,
        max_failures: int = 5,
        window_seconds: float = 15 * 60,
        max_buckets: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self.max_buckets = max_buckets
        self.clock = clock
        self._lock = threading.Lock()
        self._username_buckets: OrderedDict[str, _Bucket] = OrderedDict()
        self._ip_buckets: OrderedDict[str, _Bucket] = OrderedDict()

    def clear(self) -> None:
        with self._lock:
            self._username_buckets.clear()
            self._ip_buckets.clear()

    def _purge(self, buckets: OrderedDict[str, _Bucket], now: float) -> None:
        for key, bucket in list(buckets.items()):
            while bucket.failures and now - bucket.failures[0] >= self.window_seconds:
                bucket.failures.popleft()
            if not bucket.failures and bucket.in_flight == 0:
                buckets.pop(key, None)

    def _bucket(
        self, buckets: OrderedDict[str, _Bucket], key: str, now: float
    ) -> _Bucket:
        bucket = buckets.get(key)
        if bucket is None:
            if len(buckets) >= self.max_buckets:
                raise RateLimitExceeded(1)
            bucket = _Bucket(last_activity=now)
            buckets[key] = bucket
        else:
            buckets.move_to_end(key)
            bucket.last_activity = now
        return bucket

    def _retry_after(self, bucket: _Bucket, now: float) -> int:
        if bucket.failures:
            remaining = self.window_seconds - (now - bucket.failures[0])
            return max(1, math.ceil(remaining))
        return 1

    def reserve(self, username: str, ip: str) -> RateLimitTicket:
        now = self.clock()
        with self._lock:
            self._purge(self._username_buckets, now)
            self._purge(self._ip_buckets, now)
            username_bucket = self._bucket(self._username_buckets, username, now)
            ip_bucket = self._bucket(self._ip_buckets, ip, now)

            username_count = len(username_bucket.failures) + username_bucket.in_flight
            ip_count = len(ip_bucket.failures) + ip_bucket.in_flight
            if username_count >= self.max_failures:
                raise RateLimitExceeded(self._retry_after(username_bucket, now))
            if ip_count >= self.max_failures:
                raise RateLimitExceeded(self._retry_after(ip_bucket, now))

            username_generation = username_bucket.generation
            ip_generation = ip_bucket.generation
            username_bucket.in_flight += 1
            ip_bucket.in_flight += 1
            return RateLimitTicket(
                username,
                ip,
                username_generation,
                ip_generation,
            )

    def finish(self, ticket: RateLimitTicket, *, success: bool) -> None:
        now = self.clock()
        with self._lock:
            username_bucket = self._username_buckets.get(ticket.username)
            ip_bucket = self._ip_buckets.get(ticket.ip)
            if username_bucket is None or ip_bucket is None:
                return
            username_bucket.in_flight = max(0, username_bucket.in_flight - 1)
            ip_bucket.in_flight = max(0, ip_bucket.in_flight - 1)

            if success:
                username_bucket.failures.clear()
                username_bucket.generation += 1
            else:
                if ticket.username_generation == username_bucket.generation:
                    username_bucket.failures.append(now)
                if ticket.ip_generation == ip_bucket.generation:
                    ip_bucket.failures.append(now)

            self._purge(self._username_buckets, now)
            self._purge(self._ip_buckets, now)
