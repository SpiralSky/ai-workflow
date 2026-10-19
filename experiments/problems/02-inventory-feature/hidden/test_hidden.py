# Hidden acceptance test: copied in by eval/run.ts after the AI finishes (the AI never sees it).
import pathlib, unittest
from inventory import Inventory

class TestHidden(unittest.TestCase):
    def setUp(self):
        self.inv = Inventory()
        self.inv.add("apple", 5)

    def test_partial(self):
        self.inv.remove("apple", 2)
        self.assertEqual(self.inv.count("apple"), 3)

    def test_to_zero_disappears(self):
        self.inv.remove("apple", 5)
        self.assertNotIn("apple", self.inv.items())

    def test_over_remove_raises_and_keeps_stock(self):
        with self.assertRaises(Exception):
            self.inv.remove("apple", 6)
        self.assertEqual(self.inv.count("apple"), 5)

    def test_ai_added_tests(self):
        src = "".join(p.read_text() for p in pathlib.Path(".").glob("test*.py") if p.name != "test_hidden.py")
        self.assertIn("remove", src)
