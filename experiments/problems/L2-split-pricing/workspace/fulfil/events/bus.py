from collections import defaultdict
from threading import RLock
from typing import Callable, TypeVar

E = TypeVar("E")


class EventBus:
    def __init__(self):
        self._handlers: dict[type, list[Callable]] = defaultdict(list)
        self._history: list[object] = []
        self._registration_keys: dict[tuple[type, str], Callable] = {}
        self._lock = RLock()

    def subscribe(self, event_type: type[E], handler: Callable[[E], None]) -> bool:
        with self._lock:
            handlers = self._handlers[event_type]
            if handler in handlers:
                return False
            handlers.append(handler)
            return True

    def subscribe_once(self, event_type: type[E], key: str, handler: Callable[[E], None]) -> bool:
        registration = (event_type, key)
        with self._lock:
            if registration in self._registration_keys:
                return False
            self._registration_keys[registration] = handler
            self._handlers[event_type].append(handler)
            return True

    def publish(self, event: object) -> None:
        with self._lock:
            self._history.append(event)
            handlers = tuple(self._handlers.get(type(event), ()))
        errors = []
        for handler in handlers:
            try:
                handler(event)
            except Exception as exc:
                errors.append(exc)
        if errors:
            raise EventDispatchError(event, errors)

    def replay(self, events: list[object]) -> None:
        for event in events:
            self.publish(event)

    def history(self, event_type: type | None = None) -> list[object]:
        with self._lock:
            items = list(self._history)
        return items if event_type is None else [item for item in items if isinstance(item, event_type)]

    def handler_count(self, event_type: type) -> int:
        with self._lock:
            return len(self._handlers.get(event_type, ()))

    def subscriptions(self) -> dict[str, int]:
        with self._lock:
            return {event_type.__name__: len(handlers) for event_type, handlers in self._handlers.items()}

    def clear_history(self) -> int:
        with self._lock:
            count = len(self._history)
            self._history.clear()
            return count

    def unsubscribe(self, event_type: type, handler: Callable) -> bool:
        with self._lock:
            handlers = self._handlers.get(event_type, [])
            if handler not in handlers:
                return False
            handlers.remove(handler)
            for key, registered in list(self._registration_keys.items()):
                if key[0] is event_type and registered is handler:
                    del self._registration_keys[key]
            return True

    def unsubscribe_key(self, event_type: type, key: str) -> bool:
        registration = (event_type, key)
        with self._lock:
            handler = self._registration_keys.pop(registration, None)
            if handler is None:
                return False
            handlers = self._handlers.get(event_type, [])
            if handler in handlers:
                handlers.remove(handler)
            return True

    def publish_many(self, events: list[object]) -> int:
        published = 0
        for event in events:
            self.publish(event)
            published += 1
        return published


class EventDispatchError(RuntimeError):
    def __init__(self, event: object, errors: list[Exception]):
        self.event = event
        self.errors = errors
        super().__init__(f"{len(errors)} handler(s) failed for {type(event).__name__}")
