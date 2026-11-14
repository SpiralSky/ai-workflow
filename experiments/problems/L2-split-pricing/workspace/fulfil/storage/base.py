from copy import deepcopy
from threading import RLock
from typing import Callable, Generic, TypeVar

T = TypeVar("T")


class InMemoryRepository(Generic[T]):
    def __init__(self, key_of):
        self._items: dict[str, T] = {}
        self._key_of = key_of
        self._lock = RLock()
        self._version = 0

    @property
    def version(self) -> int:
        return self._version

    def add(self, item: T) -> None:
        key = str(self._key_of(item))
        with self._lock:
            if key in self._items:
                raise KeyError(f"duplicate key {key}")
            self._items[key] = deepcopy(item)
            self._version += 1

    def save(self, item: T) -> None:
        key = str(self._key_of(item))
        with self._lock:
            self._items[key] = deepcopy(item)
            self._version += 1

    def get(self, key: str) -> T:
        with self._lock:
            try:
                return deepcopy(self._items[str(key)])
            except KeyError:
                raise KeyError(f"no record for {key}") from None

    def find(self, key: str) -> T | None:
        with self._lock:
            item = self._items.get(str(key))
            return deepcopy(item) if item is not None else None

    def all(self) -> list[T]:
        with self._lock:
            return deepcopy(list(self._items.values()))

    def delete(self, key: str) -> bool:
        with self._lock:
            if str(key) not in self._items:
                return False
            del self._items[str(key)]
            self._version += 1
            return True

    def count(self) -> int:
        with self._lock:
            return len(self._items)

    def clear(self) -> None:
        with self._lock:
            if self._items:
                self._items.clear()
                self._version += 1

    def update(self, key: str, change: Callable[[T], T], expected_version: int | None = None) -> T:
        with self._lock:
            if expected_version is not None and expected_version != self._version:
                raise RuntimeError("repository changed since the caller read it")
            try:
                current = deepcopy(self._items[str(key)])
            except KeyError:
                raise KeyError(f"no record for {key}") from None
            updated = change(current)
            if updated is None:
                updated = current
            normalized_key = str(self._key_of(updated))
            if normalized_key != str(key):
                raise ValueError("an update cannot change the repository key")
            self._items[normalized_key] = deepcopy(updated)
            self._version += 1
            return deepcopy(updated)

    def query(self, predicate: Callable[[T], bool]) -> list[T]:
        with self._lock:
            items = deepcopy(list(self._items.values()))
        return [item for item in items if predicate(item)]

    def page(self, offset: int = 0, limit: int = 50) -> tuple[list[T], int]:
        if offset < 0 or limit <= 0:
            raise ValueError("page offset and limit are invalid")
        items = self.all()
        return items[offset:offset + limit], len(items)

    def keys(self) -> list[str]:
        with self._lock:
            return sorted(self._items)
