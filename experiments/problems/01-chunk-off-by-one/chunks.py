def chunk(items, size):
    """Split items into lists of length `size` (last one may be shorter)."""
    if size <= 0:
        raise ValueError("size must be positive")
    return [items[i:i + size] for i in range(0, len(items) - size + 1, size)]
