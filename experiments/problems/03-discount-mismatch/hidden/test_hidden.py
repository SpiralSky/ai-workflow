# Hidden acceptance test: copied in by eval/run.ts after the AI finishes (the AI never sees it).
import unittest
from pricing import final_price

class TestHidden(unittest.TestCase):
    def test_promos(self):
        self.assertEqual(final_price(100, "spring"), 85)
        self.assertEqual(final_price(100, "staff"), 70)
        self.assertEqual(final_price(100, "none"), 100)
        self.assertEqual(final_price(100), 100)
