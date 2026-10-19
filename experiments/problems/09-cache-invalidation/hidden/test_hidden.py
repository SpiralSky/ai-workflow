"""Hidden acceptance tests: verify that GET returns fresh data after an update."""
import unittest
from api import _svc, handle_create, handle_get, handle_update


def reset():
    _svc._store._data.clear()
    _svc._cache.clear()


class TestCacheInvalidation(unittest.TestCase):
    def setUp(self):
        reset()

    def test_get_after_update_returns_new_data(self):
        handle_create("x1", {"name": "Original", "price": 1})
        handle_get("x1")  # warms the cache
        handle_update("x1", {"name": "Updated", "price": 99})
        product, status = handle_get("x1")
        self.assertEqual(status, 200)
        self.assertEqual(
            product["name"], "Updated",
            f"Expected 'Updated' but got {product['name']!r} — cache was not invalidated on update"
        )

    def test_price_reflects_latest_update(self):
        handle_create("x2", {"name": "Item", "price": 10})
        handle_get("x2")  # warm cache
        handle_update("x2", {"name": "Item", "price": 20})
        handle_update("x2", {"name": "Item", "price": 30})
        product, _ = handle_get("x2")
        self.assertEqual(product["price"], 30, "Price should reflect the last update, not a cached value")

    def test_create_update_delete_then_404(self):
        handle_create("x3", {"name": "Ephemeral", "price": 5})
        handle_get("x3")  # warm cache
        handle_update("x3", {"name": "Ephemeral v2", "price": 6})
        from api import handle_delete
        handle_delete("x3")
        _, status = handle_get("x3")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
