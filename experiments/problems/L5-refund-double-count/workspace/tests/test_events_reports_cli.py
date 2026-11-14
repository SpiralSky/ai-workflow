import unittest
from datetime import datetime, timezone

from fulfil.cli.commands import AdminCommands
from fulfil.events.bus import EventBus
from fulfil.events.handlers import handler_status, register_handlers, unregister_application_handlers
from fulfil.events.types import RefundProcessed, StockChanged
from fulfil.models import Address, Customer, Money, Order, OrderLine, OrderStatus, Product, Refund, Sku
from fulfil.reports.refunds import RefundReport
from fulfil.reports.revenue import RevenueReport
from fulfil.reports.stock import StockReport
from fulfil.services.inventory import InventoryService
from fulfil.storage.repositories import RepositorySet
from fulfil.util.dates import add_business_days, month_bounds, parse_timestamp, within_window
from fulfil.util.ids import new_id, stable_reference
from fulfil.util.money import format_money, parse_money, sum_money
from fulfil.util.validation import bounded_integer, validate_postal_code, validate_sku


class EventTests(unittest.TestCase):
    def setUp(self):
        self.repositories = RepositorySet()
        self.bus = EventBus()
        self.repositories.products.add(Product(Sku("pen-1"), "Ink Pen", Money(350), 6))

    def test_registration_is_safe_and_events_are_visible(self):
        register_handlers(self.bus, self.repositories)
        register_handlers(self.bus, self.repositories)
        self.assertEqual(self.bus.handler_count(StockChanged), 1)
        self.assertEqual(handler_status(self.bus)["StockChanged"], 1)
        inventory = InventoryService(self.repositories, self.bus)
        inventory.restock(Sku("pen-1"), 2)
        self.assertEqual(self.repositories.products.get("pen-1").stock_on_hand, 8)
        self.assertEqual(len(self.bus.history(StockChanged)), 1)
        self.assertEqual(unregister_application_handlers(self.bus, self.repositories), 6)

    def test_event_failures_are_reported_after_dispatch(self):
        errors = []
        self.bus.subscribe(StockChanged, lambda event: (_ for _ in ()).throw(ValueError("broken")))
        self.bus.subscribe(StockChanged, lambda event: errors.append(event.sku))
        with self.assertRaises(RuntimeError):
            self.bus.publish(StockChanged("pen-1", 1, "test"))
        self.assertEqual(errors, ["pen-1"])
        self.assertEqual(len(self.bus.history()), 1)


class ReportAndCliTests(unittest.TestCase):
    def setUp(self):
        self.repositories = RepositorySet()
        self.bus = EventBus()
        register_handlers(self.bus, self.repositories)
        self.customer = Customer("cus-9", "Casey", "casey@example.test",
                                 [Address("Casey", "1 High Street", "London", "W1A", "GB")])
        self.repositories.customers.add(self.customer)
        self.repositories.products.add(Product(Sku("book-1"), "Travel Journal", Money(1200), 2))
        created = datetime(2026, 4, 8, 12, tzinfo=timezone.utc)
        order = Order("ord-apr", "cus-9", "USD", [OrderLine(Sku("book-1"), "Travel Journal", 1, Money(1200))],
                      OrderStatus.PAID, created_at=created)
        order.shipping_fee = Money(0)
        order.tax = Money(99)
        self.repositories.orders.add(order)
        refund = Refund("rfd-apr", order.order_id, Money(300), "damaged cover", created_at=created)
        self.repositories.refunds.add(refund)
        refund.mark_processed()
        self.repositories.refunds.save(refund)

    def test_monthly_revenue_uses_persisted_refunds_once(self):
        report = RevenueReport(self.repositories)
        row = report.monthly(2026, 4)[0]
        self.assertEqual(row.gross, Money(1299))
        self.assertEqual(row.refunds, Money(300))
        self.assertEqual(row.net, Money(999))
        event = RefundProcessed("rfd-apr", "ord-apr", Money(300), datetime(2026, 4, 8, tzinfo=timezone.utc))
        self.assertEqual(report.monthly(2026, 4, [event])[0].refunds, Money(300))
        self.assertEqual(report.product_units(2026, 4), {Sku("book-1"): 1})

    def test_stock_refund_reports_and_admin_commands(self):
        stock = StockReport(self.repositories, low_stock_level=3)
        self.assertTrue(stock.rows()[0].low)
        self.assertEqual(stock.replenishment(10), [("BOOK-1", 8)])
        self.assertIn("USD", stock.value_by_currency())
        self.assertEqual(RefundReport(self.repositories).totals()["USD"], Money(300))
        commands = AdminCommands(self.repositories, self.bus)
        self.assertIn("BOOK-1", commands.restock("book-1", 4))
        self.assertIn("Revenue", commands.revenue_report(2026, 4))
        self.assertEqual(commands.replay([]), 0)
        self.assertIn("handler(s)", commands.event_summary())
        self.assertEqual(commands.unprocessed_refunds(), [])


class UtilityTests(unittest.TestCase):
    def test_ids_money_dates_and_validation(self):
        self.assertTrue(new_id("ord").startswith("ord-"))
        self.assertEqual(stable_reference("order", "A / 1"), "order:a-1")
        self.assertEqual(format_money(Money(1234)), "$12.34")
        self.assertEqual(parse_money("$12.34"), Money(1234))
        self.assertEqual(sum_money([Money(100), Money(200)]), Money(300))
        start, end = month_bounds(2026, 2)
        self.assertEqual((start.month, end.month), (2, 3))
        self.assertTrue(within_window(start, start, end))
        self.assertEqual(add_business_days(datetime(2026, 4, 10).date(), 1).isoformat(), "2026-04-13")
        self.assertEqual(parse_timestamp("2026-04-01T10:00:00Z").tzinfo, timezone.utc)
        self.assertEqual(bounded_integer(3, "limit", 1, 5), 3)
        self.assertEqual(validate_sku("ab-1"), "AB-1")
        self.assertEqual(validate_postal_code("94612"), "94612")
        with self.assertRaises(ValueError):
            validate_postal_code("not-a-zip")


if __name__ == "__main__":
    unittest.main()
