from itertools import count
from threading import Lock
from uuid import uuid4

_sequence = count(1)
_lock = Lock()


def new_id(prefix: str) -> str:
    if not prefix or not prefix.replace("-", "").isalnum():
        raise ValueError("id prefix must be alphanumeric")
    with _lock:
        suffix = next(_sequence)
    return f"{prefix.lower()}-{suffix:06d}-{uuid4().hex[:8]}"


def stable_reference(kind: str, *parts: str) -> str:
    if not kind or not parts:
        raise ValueError("kind and at least one reference part are required")
    safe = ["-".join(filter(None, "".join(ch.lower() if ch.isalnum() else "-" for ch in part).split("-")))
            for part in parts]
    if any(not part for part in safe):
        raise ValueError("reference parts must contain letters or digits")
    return f"{kind.lower()}:{':'.join(safe)}"
