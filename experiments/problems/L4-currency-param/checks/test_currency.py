import unittest
from decimal import Decimal

from fulfil.api.handlers import (create_application, place_order, get_order, customer_orders,
    amend_order, cancel_order_line, refund_order, shipping_options, invoice_order, get_product)
from fulfil.api.schemas import OrderRequest
from fulfil.cli.commands import AdminCommands
from fulfil.events.bus import EventBus
from fulfil.models import Address, Customer, Money, Order, OrderLine, Product, Refund, Sku
from fulfil.services.invoicing import (render_invoice, invoice_lines, invoice_total_label,
                                      invoice_tax_lines, credit_note)
from fulfil.services.notifications import NotificationService
from fulfil.storage.repositories import RepositorySet
from fulfil.util.money import format_money


class CurrencyTests(unittest.TestCase):
    def order(self, currency):
        return Order("ord-currency", "cus-currency", currency,
                     [OrderLine(Sku("item-one"), "First", 2, Money(1250, currency), Money(250, currency)),
                      OrderLine(Sku("item-one"), "Second", 1, Money(250, currency))],
                     shipping_fee=Money(100, currency), tax=Money(200, currency))

    def marked(self, text, symbol):
        self.assertIn(symbol, text)
        for wrong in set("$€£") - {symbol}:
            self.assertNotIn(wrong, text)

    def test_formatter_explicit_currency_and_unchanged_default(self):
        for currency, symbol in (("USD", "$"), ("EUR", "€"), ("GBP", "£")):
            for amount in (Decimal("1234.5"), 1234.5, "1234.5", Money(123450, currency)):
                self.assertEqual(format_money(amount, currency=currency), symbol + "1,234.50")
                self.assertEqual(format_money(amount), "$1,234.50")
            self.assertEqual(format_money(0, currency), symbol + "0.00")
            self.assertEqual(format_money(Decimal("-1.25"), currency), symbol + "-1.25")

    def test_invoice_paths_and_zero_discounts(self):
        for currency, symbol in (("EUR", "€"), ("GBP", "£")):
            order = self.order(currency)
            text = render_invoice(order)
            self.marked(text, symbol)
            for amount in ("22.50", "2.50", "25.00", "1.00", "2.00", "28.00"):
                self.assertIn(symbol + amount, text)
            self.assertEqual(invoice_total_label(order), "Amount due: " + symbol + "28.00 " + currency)
            rows = invoice_lines(order)
            self.assertEqual(rows[0]["unit_price"], symbol + "12.50")
            self.assertEqual(rows[0]["discount"], symbol + "2.50")
            self.assertEqual(rows[0]["discount_per_unit"], symbol + "1.25")
            self.assertEqual(rows[0]["effective_unit_price"], symbol + "11.25")
            self.assertEqual(rows[1]["discount"], symbol + "0.00")
            for row in invoice_tax_lines(order):
                self.marked(row["tax"], symbol)
            self.marked(credit_note(order, Money(250, currency), "return"), symbol)

    def test_notification_paths(self):
        customer = Customer("cus-currency", "Robin", "robin@example.test")
        for currency, symbol in (("EUR", "€"), ("GBP", "£")):
            order = self.order(currency)
            refund = Refund("ref-currency", order.order_id, Money(250, currency), "return")
            service = NotificationService()
            for text in (service.order_confirmation(customer, order).body,
                         service.order_update(customer, order, "Updated").body,
                         service.render_order_email(customer, order),
                         service.order_email(customer, order).body):
                self.assertIn(symbol + "28.00", text)
                self.marked(text, symbol)
            for text in (service.render_refund_email(customer, order, refund),
                         service.refund_email(customer, order, refund).body):
                self.assertIn(symbol + "2.50", text)
                self.marked(text, symbol)

    def test_api_order_lifecycle_and_default_product_display(self):
        for currency, symbol in (("EUR", "€"), ("GBP", "£")):
            app = create_application()
            address = Address("Robin", "9 Elm Way", "Oakland", "94612")
            customer = Customer("cus-currency", "Robin", "robin@example.test", [address])
            app.repositories.customers.add(customer)
            app.repositories.products.add(Product(Sku("item-one"), "First", Money(1250, currency), 20))
            request = OrderRequest(customer.customer_id, [{"sku": "item-one", "quantity": 3}],
                                   currency=currency, shipping_address=address)
            placed = place_order(app, request)
            self.assertEqual(placed.status, 201)
            self.marked(placed.body["total"], symbol)
            oid = placed.body["order_id"]
            detail = get_order(app, oid).body
            for key in ("subtotal", "shipping", "tax", "total"):
                self.marked(detail[key], symbol)
            self.marked(detail["lines"][0]["line_total"], symbol)
            self.marked(customer_orders(app, customer.customer_id).body["items"][0]["total"], symbol)
            self.marked(amend_order(app, oid, request).body["total"], symbol)
            self.marked(cancel_order_line(app, oid, "item-one", 1).body["total"], symbol)
            options = shipping_options(app, oid, "94612")
            self.assertEqual(options.status, 200)
            self.assertTrue(options.body["rates"])
            for rate in options.body["rates"]:
                self.marked(rate["amount"], symbol)
            self.marked(invoice_order(app, oid).body["invoice"], symbol)
            app.orders.mark_paid(oid)
            refunded = refund_order(app, oid, Money(250, currency))
            self.assertEqual(refunded.status, 201)
            self.assertEqual(refunded.body["amount"], symbol + "2.50")
            self.assertEqual(get_product(app, "item-one").body["price"], "$12.50")
            zero = Order("empty", customer.customer_id, currency)
            app.repositories.orders.add(zero)
            detail = get_order(app, "empty").body
            for key in ("subtotal", "shipping", "tax", "total"):
                self.assertEqual(detail[key], symbol + "0.00")

    def test_cross_currency_cli_totals_keep_existing_display(self):
        repositories = RepositorySet()
        for currency in ("USD", "EUR", "GBP"):
            order = self.order(currency)
            order.order_id = "ord-" + currency
            repositories.orders.add(order)
        cli = AdminCommands(repositories, EventBus())
        self.assertEqual(cli.multi_currency_totals(), "EUR: $28.00\nGBP: $28.00\nUSD: $28.00")
