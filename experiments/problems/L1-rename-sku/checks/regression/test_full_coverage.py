import unittest
from datetime import date, datetime, timezone
from decimal import Decimal

from fulfil.api.handlers import (
    amend_order, cancel_order_line, create_application, create_shipment, deliver_shipment,
    dispatch_shipment, get_product, health, invoice_order, refund_order, search_products,
    shipping_options, update_customer_address,
)
from fulfil.api.schemas import (
    ApiResponse, OrderRequest, PageRequest, ProductLookup, error_response, page_response,
)
from fulfil.cli.commands import AdminCommands
from fulfil.config import Settings
from fulfil.events.bus import EventBus, EventDispatchError
from fulfil.events.handlers import register_handlers, unregister_application_handlers
from fulfil.events.types import (
    CustomerAddressChanged, OrderCancelled, OrderPlaced, RefundProcessed,
    ShipmentLabelCreated, StockChanged, event_name,
)
from fulfil.models import (
    Address, BackorderRequest, Customer, Money, Order, OrderLine, OrderStatus,
    Product, Refund, Shipment, ProductCode,
)
from fulfil.models.fulfillment import ShipmentState
from fulfil.pricing import FixedDiscount, SkuPriceRule
from fulfil.reports.refunds import RefundReport
from fulfil.reports.revenue import RevenueReport, RevenueRow
from fulfil.reports.stock import StockReport
from fulfil.services.inventory import InventoryService
from fulfil.services.orders import OrderService
from fulfil.services.shipping import ShippingRate, ShippingService
from fulfil.storage.base import InMemoryRepository
from fulfil.storage.repositories import RepositorySet
from fulfil.storage.uow import UnitOfWork
from fulfil.util.dates import (
    add_business_days, age_in_days, end_of_day, iso_utc, month_bounds, parse_timestamp,
    start_of_day, utc_now, week_bounds, within_window,
)
from fulfil.util.ids import new_id, stable_reference
from fulfil.util.money import format_money, parse_money, sum_money
from fulfil.util.validation import (
    bounded_integer, one_of, positive_integer, require_email, require_text,
    validate_country_code, validate_metadata, validate_postal_code, validate_sku,
)


class ModelPublicMethodTests(unittest.TestCase):
    def setUp(self):
        self.sku = ProductCode("case-1")
        self.product = Product(self.sku, "Case", Money(2400), 10)
        self.address = Address("Alex Kim", "5 Pine Street", "Oakland", "94612")
        self.customer = Customer("cus-public", "Alex Kim", "alex@example.test", [self.address])
        self.line = OrderLine(self.sku, "Case", 2, Money(2400), Money(200))
        self.order = Order("ord-public", self.customer.customer_id, "USD", [self.line])

    def test_money_address_customer_and_product_helpers(self):
        self.assertFalse(Money(1).is_zero())
        self.assertTrue(Money(0).is_zero())
        self.assertEqual(Money(-4).absolute(), Money(4))
        self.assertEqual(Money(10).clamp(Money(5), Money(8)), Money(8))
        self.assertEqual(Money(10000).percentage(125), Money(125))
        self.assertIn("Oakland", self.address.one_line())
        self.assertEqual(self.address.delivery_key(), self.customer.primary_address().delivery_key())
        self.assertEqual(self.customer.address_index(self.address), 0)
        self.customer.set_marketing_opt_in(True)
        self.assertTrue(self.customer.can_receive_marketing())
        self.assertEqual(self.customer.remove_address(0), self.address)
        self.product.set_dimensions(500, 1000)
        self.assertEqual(self.product.shipping_dimensions(), (500, 1000))
        self.product.set_quantity_breaks((2, 6), Decimal(".05"))
        self.assertEqual(self.product.break_quantities, (2, 6))
        with self.assertRaises(ValueError):
            self.product.set_quantity_breaks((2, 2), Decimal(".05"))

    def test_order_helpers_and_shipment_refund_lifecycle(self):
        self.assertTrue(self.order.is_open())
        self.assertTrue(self.order.can_amend())
        self.assertFalse(self.order.can_refund())
        self.assertEqual(self.order.total_quantity(), 2)
        self.order.set_note("gift", " wrapped ")
        self.order.cancel_reason("duplicate purchase")
        self.assertEqual(self.order.metadata["gift"], "wrapped")
        self.assertEqual(self.order.cancellation_history, [])
        self.assertEqual(self.order.tax_rate_basis_points(), 0)
        self.order.transition(OrderStatus.PLACED)
        self.assertEqual(self.order.status_history[-1][0], "placed")
        self.order.transition(OrderStatus.PAID)
        self.assertTrue(self.order.can_refund())
        shipment = Shipment("shp-public", self.order.order_id, "parcel-post", "standard")
        shipment.attach_label("TRACKPUBLIC")
        self.assertTrue(shipment.validate_label())
        self.assertIn("TRACKPUBLIC", shipment.tracking_url())
        arrived = shipment.estimate_arrival(datetime(2026, 4, 10, tzinfo=timezone.utc), 1)
        self.assertEqual(arrived.date(), date(2026, 4, 13))
        shipment.mark_in_transit("depot scan")
        shipment.mark_delivered(datetime(2026, 4, 13, tzinfo=timezone.utc))
        self.assertEqual(shipment.state, ShipmentState.DELIVERED)
        refund = Refund("rfd-public", self.order.order_id, Money(100), "CASE-1 returned")
        self.assertTrue(refund.applies_to(self.order.order_id, self.sku))
        refund.allocate_lines({"CASE-1#0": 100})
        refund.mark_processed()
        refund.mark_restocked()
        self.assertIn("Refund", refund.receipt_label())
        self.assertEqual(refund.outstanding(self.order.total, []), self.order.total - Money(100))
        backorder = BackorderRequest("bo-public", self.order.order_id, self.sku, 3)
        self.assertEqual(backorder.allocate(2), 2)
        self.assertEqual(backorder.cancel(1), 1)
        self.assertEqual(backorder.remaining, 0)


class RepositoryAndEventMethodTests(unittest.TestCase):
    def test_repository_query_update_and_unit_of_work_receipt(self):
        repository = InMemoryRepository(lambda item: item["id"])
        repository.add({"id": "a", "count": 1})
        version = repository.version
        changed = repository.update("a", lambda row: {**row, "count": 2}, version)
        self.assertEqual(changed["count"], 2)
        self.assertEqual(repository.query(lambda row: row["count"] > 1), [changed])
        self.assertEqual(repository.page(0, 1), ([changed], 1))
        self.assertEqual(repository.keys(), ["a"])
        with self.assertRaises(RuntimeError):
            repository.update("a", lambda row: row, version)
        with self.assertRaises(ValueError):
            repository.update("a", lambda row: {**row, "id": "b"})
        stores = RepositorySet()
        product = Product(ProductCode("uow-1"), "UOW", Money(200), 1)
        with UnitOfWork(stores) as work:
            work.add("products", product)
            work.save("products", Product(ProductCode("uow-1"), "UOW 2", Money(250), 2))
            work.commit()
        self.assertEqual([change.action for change in work.receipt.changes], ["add", "save"])
        self.assertTrue(work.receipt.committed)
        self.assertEqual(stores.counts()["products"], 1)
        self.assertFalse(stores.empty())
        with UnitOfWork(stores) as rollback:
            rollback.delete("products", "UOW-1")
        self.assertTrue(stores.products.find("uow-1"))

    def test_bus_subscription_history_and_bulk_dispatch(self):
        bus = EventBus()
        received = []
        handler = received.append
        self.assertTrue(bus.subscribe(StockChanged, handler))
        self.assertFalse(bus.subscribe(StockChanged, handler))
        self.assertEqual(bus.publish_many([StockChanged("A-1", 1, "test"), StockChanged("A-1", 2, "test")]), 2)
        self.assertEqual(len(bus.history(StockChanged)), 2)
        self.assertEqual(bus.subscriptions(), {"StockChanged": 1})
        self.assertTrue(bus.unsubscribe(StockChanged, handler))
        self.assertFalse(bus.unsubscribe(StockChanged, handler))
        self.assertEqual(bus.clear_history(), 2)
        failing = EventBus()
        failing.subscribe(StockChanged, lambda _: (_ for _ in ()).throw(ValueError("bad")))
        with self.assertRaises(EventDispatchError):
            failing.publish(StockChanged("A-1", 1, "error"))
        self.assertEqual(event_name(OrderPlaced("O-1", "C-1", Money(50))), "OrderPlaced")
        self.assertIsInstance(OrderCancelled("O-1", "duplicate"), OrderCancelled)
        self.assertIsInstance(RefundProcessed("R-1", "O-1", Money(1)), RefundProcessed)
        self.assertIsInstance(ShipmentLabelCreated("S-1", "O-1", "T-1", "carrier"), ShipmentLabelCreated)
        self.assertIsInstance(CustomerAddressChanged("C-1", 0), CustomerAddressChanged)


class ServiceAndReportPublicMethodTests(unittest.TestCase):
    def setUp(self):
        self.repositories = RepositorySet()
        self.bus = EventBus()
        register_handlers(self.bus, self.repositories)
        self.inventory = InventoryService(self.repositories, self.bus)
        self.address = Address("Rory", "8 Oak Road", "Oakland", "94612")
        self.customer = Customer("cus-methods", "Rory", "rory@example.test", [self.address])
        self.repositories.customers.add(self.customer)
        self.product = Product(ProductCode("item-88"), "Desk Tray", Money(1300), 15)
        self.repositories.products.add(self.product)
        self.orders = OrderService(self.repositories, self.inventory, self.bus)

    def test_order_inventory_and_shipping_choices(self):
        order = self.orders.place(self.customer.customer_id, [(self.product.sku, 3)], address=self.address)
        self.assertEqual(self.orders.order_history(self.customer.customer_id)[0], order)
        self.assertEqual(self.inventory.reservation(order.order_id)[self.product.sku], 3)
        self.assertEqual(self.inventory.available(self.product.sku), 12)
        preview_rule = self.orders.preview_rule(order.order_id, SkuPriceRule(self.product.sku, Money(1200)))
        self.assertEqual(preview_rule.lines[0].unit_price, Money(1200))
        preview_promo = self.orders.preview_promotion(
            order.order_id, FixedDiscount("PREVIEW", "preview", amount=Money(50)))
        self.assertEqual(preview_promo.promotion_code, "PREVIEW")
        self.inventory.reserve_from_lines("extra-res", [OrderLine(self.product.sku, "Desk Tray", 1, Money(1300))])
        self.assertEqual(self.inventory.reservation("extra-res")[self.product.sku], 1)
        self.inventory.release("extra-res")
        self.inventory.release_product(self.product.sku, 1, "cycle count")
        self.inventory.set_active(self.product.sku, False)
        self.assertFalse(self.repositories.products.get(self.product.sku).active)
        self.inventory.set_active(self.product.sku, True)
        self.assertNotEqual(self.orders.compare_reprice(order.order_id)[1], 1)
        self.orders.recalculate(order.order_id)
        self.orders.mark_paid(order.order_id)
        self.orders.mark_fulfilled(order.order_id)
        self.assertEqual(self.repositories.orders.get(order.order_id).status, OrderStatus.FULFILLED)
        shipping = ShippingService(self.repositories, self.bus)
        rates = shipping.rates(order, self.address)
        self.assertEqual(shipping.select_rate(rates).service, "standard")
        self.assertEqual(shipping.cheapest_for_zone(order, self.address, "domestic"), rates[0])
        self.assertEqual(shipping.compare_carriers(rates[0], rates[1]), -1)
        self.assertGreaterEqual(shipping.parcel_surcharge(order, 2000, 5000).minor, 0)

    def test_revenue_stock_and_refund_grouping(self):
        order = self.orders.place(self.customer.customer_id, [(self.product.sku, 2)], address=self.address)
        self.orders.mark_paid(order.order_id)
        refund = Refund("rfd-report", order.order_id, Money(250), "quality", datetime(2026, 4, 8, tzinfo=timezone.utc))
        refund.mark_processed()
        self.repositories.refunds.add(refund)
        revenue = RevenueReport(self.repositories)
        start, end = datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2027, 1, 1, tzinfo=timezone.utc)
        grouped = revenue.grouped(start, end, "quarter")
        quarter = f"{order.created_at.year}-Q{(order.created_at.month - 1) // 3 + 1}"
        self.assertIn(quarter, grouped)
        row = grouped[quarter][0]
        self.assertEqual(revenue.refund_rate(row), "0.00%")
        self.assertEqual(sum(part.minor for part in revenue.allocate_net(row, [1, 1])), row.net.minor)
        self.assertEqual(revenue.compare_rows(row, row), 0)
        self.assertTrue(revenue.gross_by_day(order.created_at.year, order.created_at.month))
        self.assertTrue(revenue.channel_totals(order.created_at.year, order.created_at.month))
        self.assertTrue(revenue.year_to_date(2026))
        stock = StockReport(self.repositories)
        self.assertEqual(stock.for_sku(self.product.sku).sku, str(self.product.sku))
        self.assertGreater(stock.sku_count(), 0)
        self.assertGreater(stock.average_unit_value_minor("USD"), 0)
        self.assertIn("untagged", stock.grouped_by_tag())
        self.assertTrue(stock.restock_quantities(20, 5))
        self.assertIn("Inventory value", stock.report_value())
        report = RefundReport(self.repositories)
        self.assertEqual(report.by_reason()["quality"], refund.amount)
        self.assertEqual(report.line_breakdown(refund.refund_id), {"ITEM-88#0": 250})
        self.assertEqual(report.monthly_totals(2026, 4)["USD"], refund.amount)
        self.assertTrue(report.grouped_by_period(start, end))
        self.assertIn("USD", report.text_by_currency())


class UtilitySettingsAndCliTests(unittest.TestCase):
    def test_validation_dates_ids_money_and_settings(self):
        self.assertEqual(require_email(" user@example.test "), "user@example.test")
        self.assertEqual(require_text("  hello   world ", "name"), "hello world")
        self.assertEqual(positive_integer(2), 2)
        self.assertEqual(bounded_integer(5, "limit", 1, 8), 5)
        self.assertEqual(one_of("USD", {"USD", "EUR"}, "currency"), "USD")
        self.assertEqual(validate_country_code("gb"), "GB")
        self.assertEqual(validate_postal_code("sw1a 1aa", "GB"), "SW1A 1AA")
        self.assertEqual(validate_sku("ab_3"), "AB_3")
        self.assertEqual(validate_metadata({"source": " web "}), {"source": "web"})
        self.assertEqual(stable_reference("order", "Ref / 2"), "order:ref-2")
        self.assertTrue(new_id("evt").startswith("evt-"))
        self.assertEqual(format_money(Money(1000)), "$10.00")
        self.assertEqual(parse_money("£10.00", "GBP"), Money(1000, "GBP"))
        self.assertEqual(sum_money([Money(20), Money(30)]), Money(50))
        stamp = datetime(2026, 4, 6, 10, tzinfo=timezone.utc)
        self.assertEqual(iso_utc(stamp), "2026-04-06T10:00:00Z")
        self.assertEqual(parse_timestamp("2026-04-06T10:00:00Z"), stamp)
        self.assertEqual(start_of_day(date(2026, 4, 6)).hour, 0)
        self.assertEqual(end_of_day(date(2026, 4, 6)).day, 7)
        self.assertEqual(week_bounds(date(2026, 4, 8)), (date(2026, 4, 6), date(2026, 4, 13)))
        self.assertEqual(age_in_days(stamp, datetime(2026, 4, 8, tzinfo=timezone.utc)), 2)
        self.assertEqual(add_business_days(date(2026, 4, 10), 1), date(2026, 4, 13))
        self.assertTrue(within_window(stamp, stamp, datetime(2026, 4, 7, tzinfo=timezone.utc)))
        self.assertIsNotNone(utc_now())
        configured = Settings.from_mapping({"default_currency": "EUR", "accepted_currencies": ["EUR", "GBP"]})
        self.assertTrue(configured.permits_currency("GBP"))
        self.assertEqual(Settings.from_mapping(configured.as_mapping()).default_currency, "EUR")
        self.assertEqual(configured.fee_for(10000), 0)
        with self.assertRaises(ValueError):
            Settings.from_mapping({"unknown": True})

    def test_api_schemas_and_all_admin_command_paths(self):
        self.assertEqual(ProductLookup.parse("z-1").sku, ProductCode("Z-1"))
        page = PageRequest(1, 2)
        self.assertEqual(page.slice([0, 1, 2]), [1, 2])
        self.assertEqual(page_response(["a", "b"], page)["total"], 2)
        self.assertEqual(error_response("bad", "detail").body["detail"], "detail")
        app = create_application()
        address = Address("Admin", "3 Admin Road", "Oakland", "94612")
        customer = Customer("cus-admin", "Admin", "admin@example.test", [address])
        app.repositories.customers.add(customer)
        app.repositories.products.add(Product(ProductCode("admin-1"), "Admin Item", Money(1000), 2))
        commands = AdminCommands(app.repositories, app.bus)
        order = app.orders.place(customer.customer_id, [(ProductCode("admin-1"), 1)], address=address)
        self.assertIn("ADMIN-1", commands.product_lookup("admin-1"))
        self.assertIn("Revenue", commands.revenue_report(2026, 4))
        self.assertIn("ADMIN-1", commands.stock_report())
        self.assertIn("No refunds", commands.refund_report())
        self.assertIn("8.25", commands.tax_estimate(1000, "USD", "US-CA"))
        self.assertIn("USD", commands.multi_currency_totals())
        self.assertIn("2026", commands.sales_by_period(datetime(2026, 1, 1, tzinfo=timezone.utc),
                                                        datetime(2027, 1, 1, tzinfo=timezone.utc)))
        self.assertIn("Inventory value", commands.stock_value())
        self.assertEqual(commands.backorder_queue(), [])
        self.assertEqual(commands.open_orders(), [order.order_id])
        self.assertEqual(commands.shipment_queue(), [])
        self.assertEqual(commands.recent_orders(1), [order.order_id])
        self.assertEqual(commands.orders_by_status("placed"), [order.order_id])
        self.assertEqual(commands.marketing_recipients(), [])
        self.assertIn("%", commands.margin_report({"ADMIN-1": Money(500)})["ADMIN-1"])
        self.assertIn("target margin", commands.set_target_margin("admin-1", Money(500), Decimal(50)))
        self.assertIn("ADMIN-1", commands.markup_product("admin-1", Decimal(10)))
        self.assertIn("Disabled", commands.deactivate_product("admin-1"))
        self.assertIn("Enabled", commands.reactivate_product("admin-1"))
        self.assertIsNotNone(commands.parse_date("2026-04-01T10:00:00"))
        self.assertIn("handler(s)", commands.event_summary())
        self.assertEqual(commands.replay([StockChanged("ADMIN-1", 0, "audit")]), 1)
        self.assertEqual(commands.restock("admin-1", 2).startswith("Restocked"), True)


if __name__ == "__main__":
    unittest.main()
