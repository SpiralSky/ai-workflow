import unittest
from inventory import Inventory

class TestInventory(unittest.TestCase):
    def test_add(self):
        inv = Inventory()
        inv.add("apple", 3)
        inv.add("apple", 2)
        self.assertEqual(inv.count("apple"), 5)

    def test_add_rejects_nonpositive(self):
        with self.assertRaises(ValueError):
            Inventory().add("apple", 0)
