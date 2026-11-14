import unittest
from datetime import datetime, timezone
from decimal import Decimal

from fulfil.api.handlers import create_application, create_shipment, deliver_shipment, dispatch_shipment
from fulfil.models import Address, Customer, Money, OrderStatus, Product, Sku
from fulfil.pricing import PriceBook, PricingEngine, PromotionBook, PercentageDiscount
from fulfil.services.invoicing import (
    credit_note, invoice_discount_rate, invoice_filename, invoice_lines, invoice_tax_exempt_amount,
    invoice_tax_lines, invoice_taxable_amount, invoice_total_label, payment_reference,
    pricing_summary, render_invoice,
)
from fulfil.services.notifications import NotificationService
from fulfil.services.shipping import ShippingService


class CommerceFlowTests(unittest.TestCase):
    def setUp(self):
        self.app = create_application()
        self.address = Address("Sam Rivera", "4 Birch Lane", "Oakland", "94612")
        self.customer = Customer("cus-flow", "Sam Rivera", "sam@example.test", [self.address])
        self.app.repositories.customers.add(self.customer)
        product = Product(Sku("linen-1"), "Linen Towel", Money(1800), 12,
                          tags={"bath"}, weight_grams=400, volume_cm3=900)
        product.set_quantity_breaks((2, 5), Decimal(".04"))
        self.app.repositories.products.add(product)
        self.product = product

    def test_placed_order_amendment_and_partial_line_cancellation(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 2)], address=self.address)
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, 10)
        increased = self.app.orders.amend(order.order_id, [(Sku("linen-1"), 4)])
        self.assertEqual(increased.quantity_for(Sku("linen-1")), 4)
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, 8)
        decreased = self.app.orders.amend(order.order_id, [(Sku("linen-1"), 1)])
        self.assertEqual(decreased.quantity_for(Sku("linen-1")), 1)
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, 11)
        self.app.orders.cancel_quantity(order.order_id, Sku("linen-1"), 1, "customer changed mind")
        cancelled = self.app.repositories.orders.get(order.order_id)
        self.assertEqual(cancelled.lines, [])
        self.assertEqual(cancelled.cancellation_history[0]["reason"], "customer changed mind")
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, 12)
        with self.assertRaises(ValueError):
            self.app.orders.cancel_quantity(order.order_id, Sku("linen-1"), 1)

    def test_backorder_allocation_is_fifo_and_updates_order(self):
        self.app.repositories.products.save(Product(Sku("scarce-1"), "Rare Bowl", Money(2500), 2))
        order = self.app.orders.place("cus-flow", [(Sku("scarce-1"), 5)], address=self.address,
                                      allow_backorder=True)
        self.assertEqual(order.backorder_lines[0].quantity, 3)
        self.assertEqual(self.app.inventory.backorders(order.order_id)[0].remaining, 3)
        self.app.inventory.restock(Sku("scarce-1"), 2, "incoming carton")
        updated = self.app.repositories.orders.get(order.order_id)
        self.assertEqual(updated.backorder_lines[0].quantity, 1)
        self.assertEqual(self.app.inventory.reservation(order.order_id)[Sku("scarce-1")], 4)
        self.app.inventory.restock(Sku("scarce-1"), 1, "last unit")
        updated = self.app.repositories.orders.get(order.order_id)
        self.assertEqual(updated.backorder_lines, [])
        self.assertEqual(self.app.inventory.reservation(order.order_id)[Sku("scarce-1")], 5)

    def test_failed_reservation_does_not_leave_order_or_reduce_stock(self):
        before = self.app.repositories.products.get("linen-1").stock_on_hand
        with self.assertRaises(ValueError):
            self.app.orders.place("cus-flow", [(Sku("linen-1"), 99)], address=self.address)
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, before)
        self.assertEqual(self.app.repositories.orders.count(), 0)

    def test_tier_prices_are_used_when_quote_is_assembled(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 5)], address=self.address)
        self.assertEqual(order.lines[0].unit_price, Money(1512))
        self.assertLess(order.item_subtotal.minor, 5 * self.product.unit_price.minor)

    def test_partial_and_full_refunds_with_restocking(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 2)], address=self.address)
        self.app.orders.mark_paid(order.order_id)
        first = self.app.refunds.partial(order.order_id, Money(500), "one towel returned",
                                         {Sku("linen-1"): 1})
        self.assertTrue(first.processed)
        self.assertTrue(first.restocked)
        self.assertEqual(self.app.repositories.products.get("linen-1").stock_on_hand, 11)
        remaining = self.app.refunds.remaining_balance(order.order_id)
        second = self.app.refunds.issue(order.order_id, remaining, "balance returned")
        self.assertTrue(second.processed)
        self.assertEqual(self.app.repositories.orders.get(order.order_id).status, OrderStatus.REFUNDED)
        self.assertEqual(self.app.refunds.remaining_balance(order.order_id), Money(0))
        with self.assertRaises(ValueError):
            self.app.refunds.issue(order.order_id, Money(1))

    def test_refund_rejects_excessive_restock_before_recording(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 1)], address=self.address)
        self.app.orders.mark_paid(order.order_id)
        before = self.app.repositories.refunds.count()
        with self.assertRaises(ValueError):
            self.app.refunds.issue(order.order_id, Money(100), restock_quantities={Sku("linen-1"): 2})
        self.assertEqual(self.app.repositories.refunds.count(), before)

    def test_weight_zone_rate_selection_and_tracking_lifecycle(self):
        overseas = Address("Sam Rivera", "4 Birch Lane", "London", "SW1A 1AA", "GB")
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 2)], address=overseas)
        rates = self.app.shipping.rates(order, overseas)
        self.assertEqual(rates[0].zone, "international")
        self.assertEqual(rates[0].billable_grams, 800)
        selected = self.app.shipping.select_rate(rates, express=True)
        self.assertEqual(selected.service, "express")
        shipment = self.app.shipping.create_label(order, selected)
        self.assertTrue(shipment.validate_label())
        self.assertIn(shipment.tracking_number, shipment.tracking_url())
        dispatched = self.app.shipping.dispatch(shipment.shipment_id, "accepted at depot")
        self.assertEqual(dispatched.label_payload["first_scan"], "accepted at depot")
        delivered = self.app.shipping.confirm_delivery(shipment.shipment_id,
                                                      datetime(2026, 2, 2, tzinfo=timezone.utc))
        self.assertEqual(delivered.state.value, "delivered")
        self.assertEqual(self.app.shipping.for_order(order.order_id)[0], delivered)

    def test_remote_postcode_and_shipping_service_options(self):
        alaska = Address("Sam Rivera", "1 Ice Road", "Anchorage", "99501", "US")
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 1)], address=alaska)
        rates = self.app.shipping.quote_for_postcode(order, "99501")
        self.assertEqual(rates[0].amount.minor, 595 + 450)
        self.assertEqual(self.app.shipping.compare_carriers(rates[0], rates[1]), -1)
        coupon_rate = self.app.shipping.rate_after_coupon(rates[0], Money(100))
        self.assertEqual(coupon_rate.amount.minor, rates[0].amount.minor - 100)
        self.assertGreaterEqual(self.app.shipping.parcel_surcharge(order, 2000, 5000).minor, 0)
        with self.assertRaises(ValueError):
            self.app.shipping.select_rate(rates, maximum=Money(1))

    def test_invoice_tax_discounts_and_credit_notes(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 2)], address=self.address)
        invoice = render_invoice(order)
        self.assertIn("Subtotal:", invoice)
        self.assertIn("Tax (US-CA)", invoice)
        self.assertIn("Savings:", invoice)
        self.assertEqual(invoice_filename(order), f"invoice-{order.order_id}.txt")
        self.assertEqual(invoice_lines(order)[0]["quantity"], 2)
        self.assertIn("currency", pricing_summary(order))
        self.assertEqual(invoice_total_label(order).split(": ")[0], "Amount due")
        self.assertTrue(payment_reference(order).startswith(order.order_id))
        self.assertTrue(invoice_tax_lines(order))
        self.assertEqual(invoice_taxable_amount(order).currency, "USD")
        self.assertEqual(invoice_tax_exempt_amount(order, set()), Money(0))
        self.assertIn("%", invoice_discount_rate(order))
        credit = credit_note(order, Money(500), "returned one item")
        self.assertIn("Credit total", credit)
        with self.assertRaises(ValueError):
            credit_note(order, Money(order.total.minor + 1), "too much")

    def test_notification_email_templates_render_domain_values(self):
        order = self.app.orders.place("cus-flow", [(Sku("linen-1"), 1)], address=self.address)
        notification = NotificationService(shop_name="Northstar")
        order_text = notification.render_order_email(self.customer, order)
        self.assertIn(order.order_id, order_text)
        shipment = self.app.shipping.create_label(order, self.app.shipping.rates(order, self.address)[0])
        shipment_text = notification.render_shipment_email(self.customer, order, shipment)
        self.assertIn(shipment.tracking_number, shipment_text)
        refund = self.app.repositories.refunds
        self.app.orders.mark_paid(order.order_id)
        refund_item = self.app.refunds.issue(order.order_id, Money(100))
        self.assertIn("processed", notification.render_refund_email(self.customer, order, refund_item))
        sent = notification.order_email(self.customer, order)
        self.assertEqual(sent.recipient, self.customer.email)
        notification.shipment_email(self.customer, order, shipment)
        notification.refund_email(self.customer, order, refund_item)
        notification.order_update(self.customer, order, "  Your   parcel is ready. ")
        self.assertIn("message(s)", notification.digest())
        self.assertIn("example.test", notification.delivery_summary())
        with self.assertRaises(ValueError):
            notification.render_template("unknown", {})
        with self.assertRaises(ValueError):
            notification.render_template("order", {})


if __name__ == "__main__":
    unittest.main()
