from store import DataStore
from cache import LRUCache


class ProductService:
    def __init__(self):
        self._store = DataStore()
        self._cache = LRUCache()

    def get(self, product_id: str):
        cached = self._cache.get(product_id)
        if cached is not None:
            return cached
        value = self._store.get(product_id)
        if value is not None:
            self._cache.set(product_id, value)
        return value

    def list_all(self):
        return [self.get(k) for k in self._store.keys()]

    def create(self, product_id: str, data: dict):
        if self._store.get(product_id) is not None:
            raise ValueError(f"product {product_id!r} already exists")
        self._store.set(product_id, data)
        self._cache.set(product_id, data)
        return data

    def update(self, product_id: str, data: dict):
        if self._store.get(product_id) is None:
            raise KeyError(f"product {product_id!r} not found")
        self._store.set(product_id, data)
        return data

    def delete(self, product_id: str):
        if self._store.get(product_id) is None:
            raise KeyError(f"product {product_id!r} not found")
        self._store.delete(product_id)
        self._cache.invalidate(product_id)
