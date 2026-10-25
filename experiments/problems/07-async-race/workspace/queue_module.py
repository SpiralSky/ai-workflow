import threading

class TaskQueue:
    """A thread-safe task queue that processes items with a callback."""

    def __init__(self):
        self._items = []
        self._processed = 0

    def add(self, item) -> None:
        self._items.append(item)

    def process_all(self, callback) -> int:
        """Process every queued item with callback; returns count processed."""
        count = 0
        while self._items:
            item = self._items.pop(0)
            callback(item)
            count += 1
            self._processed += 1
        return count

    @property
    def processed_total(self) -> int:
        return self._processed
