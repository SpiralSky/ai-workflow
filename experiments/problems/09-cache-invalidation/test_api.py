import unittest
from api import _svc, handle_create, handle_get, handle_update, handle_delete


def reset():
    _svc._store._data.clear()
    _svc._cache.clear()


class TestAPI(unittest.TestCase):
    def setUp(self):
        reset()

    def test_create_and_get(self):
        body, status = handle_create("p1", {"name": "Widget", "price": 10})
        self.assertEqual(status, 201)
        product, status = handle_get("p1")
        self.assertEqual(status, 200)
        self.assertEqual(product["name"], "Widget")

    def test_create_duplicate(self):
        handle_create("p2", {"name": "A", "price": 1})
        _, status = handle_create("p2", {"name": "B", "price": 2})
        self.assertEqual(status, 409)

    def test_update_returns_new_data(self):
        handle_create("p3", {"name": "Old", "price": 5})
        body, status = handle_update("p3", {"name": "New", "price": 50})
        self.assertEqual(status, 200)
        self.assertEqual(body["name"], "New")

    def test_update_not_found(self):
        _, status = handle_update("missing", {"name": "X", "price": 0})
        self.assertEqual(status, 404)

    def test_delete(self):
        handle_create("p4", {"name": "Temp", "price": 1})
        _, status = handle_delete("p4")
        self.assertEqual(status, 204)
        _, status = handle_get("p4")
        self.assertEqual(status, 404)

    def test_delete_not_found(self):
        _, status = handle_delete("ghost")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
