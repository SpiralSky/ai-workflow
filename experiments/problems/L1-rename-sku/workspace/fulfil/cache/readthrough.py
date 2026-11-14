from threading import RLock
from time import monotonic
from typing import Callable, Generic, TypeVar

K = TypeVar("K")
V = TypeVar("V")


class ReadThroughCache(Generic[K, V]):
    def __init__(self, ttl_seconds: float = 30.0, max_entries: int = 256):
        if ttl_seconds <= 0 or max_entries <= 0:
            raise ValueError("cache limits must be positive")
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._items: dict[K, tuple[float, V]] = {}
        self._lock = RLock()
        self.hits = 0
        self.misses = 0

    def get(self, key: K, loader: Callable[[K], V]) -> V:
        now = monotonic()
        with self._lock:
            entry = self._items.get(key)
            if entry and entry[0] > now:
                self.hits += 1
                return entry[1]
            if entry:
                del self._items[key]
            self.misses += 1
        value = loader(key)
        with self._lock:
            if len(self._items) >= self.max_entries:
                oldest = min(self._items, key=lambda item: self._items[item][0])
                del self._items[oldest]
            self._items[key] = (monotonic() + self.ttl_seconds, value)
        return value

    def invalidate(self, key: K | None = None) -> None:
        with self._lock:
            if key is None:
                self._items.clear()
            else:
                self._items.pop(key, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    def keys(self) -> list[K]:
        now = monotonic()
        with self._lock:
            expired = [key for key, (deadline, _) in self._items.items() if deadline <= now]
            for key in expired:
                del self._items[key]
            return list(self._items)

    def reset_stats(self) -> tuple[int, int]:
        with self._lock:
            old = self.hits, self.misses
            self.hits = 0
            self.misses = 0
            return old

    def get_or(self, key: K, loader: Callable[[], V]) -> V:
        return self.get(key, lambda _key: loader())

    def contains(self, key: K) -> bool:
        now = monotonic()
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return False
            if entry[0] <= now:
                del self._items[key]
                return False
            return True

    def invalidate_many(self, keys: list[K]) -> int:
        removed = 0
        with self._lock:
            for key in keys:
                if key in self._items:
                    del self._items[key]
                    removed += 1
        return removed
