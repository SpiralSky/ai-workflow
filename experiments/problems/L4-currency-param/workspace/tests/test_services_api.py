import unittest
from datetime import datetime, timezone

from fulfil.api.handlers import (
    cancel_order, create_application, customer_orders, get_order, get_product,
    health, place_order, restock_product, search_products,
)
from fulfil.api.schemas import OrderRequest
from fulfil.models import Address, Customer, Money, Product, Sku
from fulfil.services.invoicing import invoice_filename, invoice_lines, render_invoice
from fulfil.services.notifications import NotificationService
from fulfil.services.shipping import ShippingService


class ServicesAndApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_application()
        self.address = Address("Morgan Doe", "10 Market Street", "Oakland", "94612")
        self.customer = Customer("cus-1", "Morgan Doe", "morgan@example.test", [self.address])
        self.app.repositories.customers.add(self.customer)
        self.app.repositories.products.add(Product(Sku("mug-1"), "Ceramic Mug", Money(1400), 10,
                                                    tags={"kitchen"}))

    def test_api_product_search_and_cache(self):
        first = get_product(self.app, "MUG-1")
        second = get_product(self.app, "MUG-1")
        self.assertEqual(first.status, 200)
        self.assertEqual(second.body["name"], "Ceramic Mug")
        self.assertEqual(self.app.product_cache.hits, 1)
        self.assertEqual(search_products(self.app, "kitchen").body["count"], 1)
        self.assertEqual(get_product(self.app, "missing").status, 404)

    def test_place_order_cancel_and_order_views(self):
        response = place_order(self.app, OrderRequest("cus-1", [{"sku": "mug-1", "quantity": 2}]))
        self.assertEqual(response.status, 201)
        order_id = response.body["order_id"]
        self.assertEqual(get_order(self.app, order_id).status, 200)
        self.assertEqual(customer_orders(self.app, "cus-1").body["total"], 1)
        self.assertEqual(self.app.repositories.products.get("mug-1").stock_on_hand, 8)
        cancelled = cancel_order(self.app, order_id, "changed mind")
        self.assertEqual(cancelled.status, 200)
        self.assertEqual(self.app.repositories.products.get("mug-1").stock_on_hand, 10)

    def test_api_invalid_request_and_restock(self):
        bad = place_order(self.app, OrderRequest("unknown", [{"sku": "mug-1", "quantity": 1}]))
        self.assertEqual(bad.status, 400)
        self.assertEqual(restock_product(self.app, "mug-1", 3).body["available"], 13)
        self.assertEqual(customer_orders(self.app, "missing").status, 404)
        self.assertEqual(health(self.app).body["products"], 1)

    def test_invoice_notifications_and_shipping(self):
        order = self.app.orders.place("cus-1", [(Sku("mug-1"), 1)], address=self.address)
        invoice = render_invoice(order)
        self.assertIn("Total:", invoice)
        self.assertEqual(invoice_filename(order), f"invoice-{order.order_id}.txt")
        self.assertEqual(invoice_lines(order)[0]["quantity"], 1)
        notifications = NotificationService()
        notice = notifications.order_confirmation(self.customer, order)
        self.assertIn("Morgan", notice.body)
        self.assertEqual(notifications.delivery_summary(), {"example.test": 1})
        ship = ShippingService(self.app.repositories)
        rates = ship.rates(order, self.address)
        shipment = ship.create_label(order, rates[0])
        self.assertTrue(shipment.tracking_number)
        self.assertEqual(ship.tracking_lookup(shipment.tracking_number), shipment)

    def test_currency_and_amendment_guards(self):
        with self.assertRaises(ValueError):
            self.app.orders.place("cus-1", [(Sku("mug-1"), 1)], currency="EUR")
        order = self.app.orders.place("cus-1", [(Sku("mug-1"), 1)], address=self.address)
        self.app.orders.mark_paid(order.order_id)
        with self.assertRaises(ValueError):
            self.app.orders.amend(order.order_id, [(Sku("mug-1"), 2)])


if __name__ == "__main__":
    unittest.main()
