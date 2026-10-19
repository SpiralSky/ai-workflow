class DataStore:
    """Simple in-memory key/value store."""

    def __init__(self):
        self._data = {}

    def get(self, key):
        return self._data.get(key)

    def set(self, key, value):
        self._data[key] = value
        return value

    def delete(self, key):
        return self._data.pop(key, None)

    def keys(self):
        return list(self._data.keys())
