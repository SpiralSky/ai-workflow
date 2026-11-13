import unittest
from pricing import final_price

class TestPricing(unittest.TestCase):
    def test_no_promo(self):
        self.assertEqual(final_price(100), 100)
