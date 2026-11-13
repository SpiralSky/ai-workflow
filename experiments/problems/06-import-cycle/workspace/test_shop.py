import unittest

class TestShop(unittest.TestCase):
    def test_imports(self):
        try:
            import models
            import services
        except ImportError as e:
            self.fail(f"Import failed: {e}")

    def test_product_display(self):
        from services import make_product, describe
        p = make_product("Widget", 9.99)
        result = describe(p)
        self.assertIn("Widget", result)
        self.assertIn("9.99", result)

    def test_format_price(self):
        from services import format_price
        self.assertEqual(format_price(2.5), "$2.50")

if __name__ == "__main__":
    unittest.main()
