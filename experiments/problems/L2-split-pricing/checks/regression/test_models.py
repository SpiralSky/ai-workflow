import unittest
from decimal import Decimal

from fulfil.models import Address, Customer, Money, Order, OrderLine, OrderStatus, Product, Sku


class MoneyTests(unittest.TestCase):
    def test_major_conversion_and_arithmetic(self):
        self.assertEqual(Money.from_major("12.345", "EUR"), Money(1235, "EUR"))
        self.assertEqual((Money(250, "GBP") + Money(75, "GBP")).minor, 325)
        self.assertEqual((Money(125, "USD") * 3).major, Decimal("3.75"))

    def test_currency_mismatch_is_rejected(self):
        with self.assertRaises(ValueError):
            Money(10, "USD") + Money(10, "EUR")
        with self.assertRaises(ValueError):
            Money(1, "CAD")


class ProductTests(unittest.TestCase):
    def setUp(self):
        self.product = Product(Sku("  item-1 "), "Canvas Bag", Money(1250), 4)

    def test_sku_normalizes_and_product_inventory_is_checked(self):
        self.assertEqual(str(self.product.sku), "ITEM-1")
        self.assertTrue(self.product.can_fulfill(4))
        self.product.adjust_stock(-2)
        self.assertEqual(self.product.stock_on_hand, 2)
        with self.assertRaises(ValueError):
            self.product.adjust_stock(-3)

    def test_price_tags_and_lifecycle(self):
        self.product.set_tags({"New", " Outdoor "})
        self.assertTrue(self.product.has_tag("outdoor"))
        self.assertEqual(self.product.inventory_value(), Money(5000))
        self.product.change_price(Money(1500))
        self.product.deactivate()
        self.assertFalse(self.product.can_fulfill(1))
        self.product.activate()
        self.assertTrue(self.product.active)

    def test_invalid_product_and_sku(self):
        with self.assertRaises(ValueError):
            Sku("bad sku")
        with self.assertRaises(ValueError):
            Product(Sku("A"), " ", Money(1), 0)


class CustomerTests(unittest.TestCase):
    def test_addresses_and_email(self):
        address = Address("Taylor Lee", "5 River Road", "Oakland", "94612")
        customer = Customer("cus-1", "Taylor Lee", "taylor@example.test", [address])
        self.assertEqual(customer.primary_address(), address)
        second = Address("Taylor Lee", "2 Main Street", "Berkeley", "94704")
        customer.add_address(second, make_primary=True)
        self.assertEqual(customer.primary_address(), second)
        self.assertEqual(customer.remove_address(0), second)
        customer.update_email("taylor+shop@example.test")
        self.assertIn("email", customer.public_profile())
        with self.assertRaises(ValueError):
            customer.update_email("bad")


class OrderTests(unittest.TestCase):
    def setUp(self):
        self.order = Order("ord-1", "cus-1", "USD")
        self.sku = Sku("A-1")
        self.order.add_line(OrderLine(self.sku, "Widget", 2, Money(500)))

    def test_totals_and_line_edits(self):
        self.assertEqual(self.order.item_subtotal, Money(1000))
        self.order.replace_quantity(self.sku, 3)
        self.assertEqual(self.order.quantity_for(self.sku), 3)
        self.assertEqual(self.order.total.minor, 1500)
        self.assertEqual(self.order.summary()["line_count"], 1)

    def test_status_transitions(self):
        self.order.transition(OrderStatus.PLACED)
        self.order.transition(OrderStatus.PAID)
        self.order.transition(OrderStatus.FULFILLED)
        with self.assertRaises(ValueError):
            self.order.transition(OrderStatus.CANCELLED)

    def test_remove_and_currency_guard(self):
        with self.assertRaises(ValueError):
            self.order.add_line(OrderLine(self.sku, "wrong currency", 1, Money(10, "EUR")))
        self.order.remove_sku(self.sku)
        self.assertEqual(self.order.lines, [])


if __name__ == "__main__":
    unittest.main()
