import unittest

from fulfil.api.handlers import (
    amend_order, cancel_order_line, create_application, create_shipment, deliver_shipment,
    dispatch_shipment, get_product, health, invoice_order, place_order, refund_order,
    search_products, shipping_options, update_customer_address,
)
from fulfil.api.schemas import OrderRequest
from fulfil.models import Address, Customer, Money, Product, Sku


class ApiWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.app = create_application()
        self.address = Address("Jamie Park", "9 Elm Way", "Oakland", "94612")
        self.customer = Customer("cus-api", "Jamie Park", "jamie@example.test", [self.address])
        self.app.repositories.customers.add(self.customer)
        self.app.repositories.products.add(Product(Sku("api-item"), "API Item", Money(2100), 8))

    def test_cache_is_evicted_by_stock_events_and_invalid_skus_are_rejected(self):
        self.assertEqual(get_product(self.app, "api-item").status, 200)
        self.assertTrue(self.app.product_cache.contains("API-ITEM"))
        self.app.inventory.restock(Sku("api-item"), 2, "cycle count")
        self.assertFalse(self.app.product_cache.contains("API-ITEM"))
        self.assertEqual(get_product(self.app, "bad sku").status, 400)
        self.assertEqual(health(self.app).body["products"], 1)
        self.assertEqual(search_products(self.app, "api").body["count"], 1)
        self.assertEqual(search_products(self.app, "api", 1000).status, 400)

    def test_api_amendment_shipping_invoice_and_shipment_transitions(self):
        placed = place_order(self.app, OrderRequest(
            self.customer.customer_id, [{"sku": "api-item", "quantity": 2}],
            shipping_address=self.address))
        self.assertEqual(placed.status, 201)
        order_id = placed.body["order_id"]
        changed = amend_order(self.app, order_id, OrderRequest(
            self.customer.customer_id, [{"sku": "api-item", "quantity": 3}],
            shipping_address=self.address))
        self.assertEqual(changed.status, 200)
        self.assertIn("invoice", invoice_order(self.app, order_id).body)
        options = shipping_options(self.app, order_id, self.address.postal_code)
        self.assertEqual(len(options.body["rates"]), 2)
        created = create_shipment(self.app, order_id, 0)
        self.assertEqual(created.status, 201)
        shipment_id = created.body["shipment_id"]
        self.assertEqual(dispatch_shipment(self.app, shipment_id).body["state"], "in_transit")
        self.assertEqual(deliver_shipment(self.app, shipment_id).body["state"], "delivered")
        line_cancel = cancel_order_line(self.app, order_id, "api-item", 1)
        self.assertEqual(line_cancel.status, 200)
        self.assertEqual(self.app.repositories.orders.get(order_id).quantity_for(Sku("api-item")), 2)
        self.assertEqual(create_shipment(self.app, "missing").status, 404)
        self.assertEqual(shipping_options(self.app, "missing", "94612").status, 404)
        self.assertEqual(invoice_order(self.app, "missing").status, 404)

    def test_api_refunds_address_updates_and_error_responses(self):
        placed = place_order(self.app, OrderRequest(
            self.customer.customer_id, [{"sku": "api-item", "quantity": 1}],
            shipping_address=self.address))
        order_id = placed.body["order_id"]
        self.app.orders.mark_paid(order_id)
        failed = refund_order(self.app, order_id, Money(999999))
        self.assertEqual(failed.status, 400)
        refunded = refund_order(self.app, order_id, Money(200), "partial return")
        self.assertEqual(refunded.status, 201)
        address = Address("Jamie Park", "70 Broadway", "Oakland", "94612")
        update = update_customer_address(self.app, self.customer.customer_id, address, make_primary=True)
        self.assertEqual(update.status, 200)
        self.assertEqual(self.app.repositories.customers.get(self.customer.customer_id).primary_address(), address)
        self.assertEqual(update_customer_address(self.app, "unknown", address).status, 404)
        self.assertEqual(update_customer_address(self.app, self.customer.customer_id, object()).status, 400)
        self.assertEqual(refund_order(self.app, "unknown").status, 404)
        self.assertEqual(cancel_order_line(self.app, order_id, "api-item", 5).status, 409)
        invalid = OrderRequest(self.customer.customer_id, [{"sku": "api-item", "quantity": 0}])
        self.assertEqual(place_order(self.app, invalid).status, 400)


if __name__ == "__main__":
    unittest.main()
