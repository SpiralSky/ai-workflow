import unittest, sys

class TestShopHidden(unittest.TestCase):
    def setUp(self):
        for mod in list(sys.modules.keys()):
            if mod in ("models", "services", "types", "utils"):
                del sys.modules[mod]

    def test_no_circular_import(self):
        try:
            import models
            import services
        except ImportError as e:
            self.fail(f"Circular import not resolved: {e}")

    def test_format_price(self):
        from services import format_price
        self.assertEqual(format_price(4.5), "$4.50")

    def test_make_and_describe(self):
        from services import make_product, describe
        p = make_product("Gadget", 19.99)
        out = describe(p)
        self.assertIn("Gadget", out)
        self.assertIn("19.99", out)

    def test_product_class(self):
        from models import Product
        p = Product("Thing", 1.0)
        self.assertEqual(p.name, "Thing")
        self.assertIn("$1.00", p.display())

if __name__ == "__main__":
    unittest.main()
