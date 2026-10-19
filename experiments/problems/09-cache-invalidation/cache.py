class LRUCache:
    """Least-recently-used cache with a fixed capacity."""

    def __init__(self, capacity=256):
        self._store = {}
        self._order = []
        self._capacity = capacity

    def get(self, key):
        if key not in self._store:
            return None
        # Move to end (most recently used).
        self._order.remove(key)
        self._order.append(key)
        return self._store[key]

    def set(self, key, value):
        if key in self._store:
            self._order.remove(key)
        elif len(self._store) >= self._capacity:
            oldest = self._order.pop(0)
            del self._store[oldest]
        self._store[key] = value
        self._order.append(key)

    def invalidate(self, key):
        """Remove key from cache so the next read goes to the store."""
        if key in self._store:
            self._order.remove(key)
            del self._store[key]

    def clear(self):
        self._store.clear()
        self._order.clear()

    def size(self):
        return len(self._store)
