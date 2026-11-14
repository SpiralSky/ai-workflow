"""Fresh-process startup scenarios for the public refund/report behavior."""
from datetime import datetime, timezone
import importlib
import sys

scenario = sys.argv[1]
if scenario == "cli-first":
    importlib.import_module("fulfil.cli.commands")
elif scenario == "reports-first":
    importlib.import_module("fulfil.reports.revenue")

from fulfil.api.handlers import create_application, refund_order
from fulfil.events.handlers import register_handlers, unregister_application_handlers, enable_reporting
from fulfil.events.types import RefundProcessed
from fulfil.models import Customer, Money, Order, OrderLine, OrderStatus, Sku

apps = [create_application(), create_application()]
if scenario == "unregistered":
    for app in apps:
        assert unregister_application_handlers(app.bus, app.repositories, app.product_cache) == 7
    importlib.import_module("fulfil.reports.revenue")
    for app in apps:
        assert app.bus.handler_count(RefundProcessed) == 0

if scenario == "api-first":
    importlib.import_module("fulfil.cli.commands")

for index, (app, currency) in enumerate(zip(apps, ("EUR", "GBP"))):
    register_handlers(app.bus, app.repositories, app.product_cache)
    register_handlers(app.bus, app.repositories, app.product_cache)
    customer = Customer("customer", "Robin", "robin@example.test")
    app.repositories.customers.add(customer)
    order = Order("order-" + str(index), customer.customer_id, currency,
                  [OrderLine(Sku("item"), "Item", 1, Money(10000, currency))],
                  OrderStatus.PAID, created_at=datetime(2026, 4, 8, tzinfo=timezone.utc))
    app.repositories.orders.add(order)
    # Two equal-valued legitimate refunds must both remain in the report.
    for _ in range(2):
        response = refund_order(app, order.order_id, Money(500, currency))
        assert response.status == 201, response.body
        saved = app.repositories.refunds.get(response.body["refund_id"])
        assert saved.processed
        saved.created_at = datetime(2026, 4, 9, tzinfo=timezone.utc)
        app.repositories.refunds.save(saved)

from fulfil.reports.revenue import RevenueReport
from fulfil.cli.commands import AdminCommands

for app, currency in zip(apps, ("EUR", "GBP")):
    row = RevenueReport(app.repositories).monthly(2026, 4)[0]
    assert row.gross == Money(10000, currency), row
    assert row.refunds == Money(1000, currency), row
    assert row.net == Money(9000, currency), row
    assert app.bus.handler_count(RefundProcessed) == 1, app.bus.subscriptions()
    assert len(app.repositories.refund_postings) == 2, app.repositories.refund_postings
    assert len(app.bus.history(RefundProcessed)) == 2
    commands = AdminCommands(app.repositories, app.bus)
    AdminCommands(app.repositories, app.bus)
    order = app.repositories.orders.all()[0]
    commands.refund(order.order_id, Money(250, currency), "CLI partial")
    for saved in app.repositories.refunds.all():
        saved.created_at = datetime(2026, 4, 9, tzinfo=timezone.utc)
        app.repositories.refunds.save(saved)
    row = RevenueReport(app.repositories).monthly(2026, 4)[0]
    assert row.refunds == Money(1250, currency), row
    assert row.net == Money(8750, currency), row
    text = commands.revenue_report(2026, 4)
    assert "refunds $12.50 net $87.50" in text, text
    assert app.bus.handler_count(RefundProcessed) == 1
    assert len(app.repositories.refund_postings) == 3
    assert len(app.bus.history(RefundProcessed)) == 3
    assert len(app.repositories.refunds.all()) == 3
    events = app.bus.history(RefundProcessed)
    app.bus.replay(events)
    assert len(app.repositories.refund_postings) == 3
    assert RevenueReport(app.repositories).monthly(2026, 4)[0].refunds == Money(1250, currency)
    assert unregister_application_handlers(app.bus, app.repositories, app.product_cache) == 7
    enable_reporting()
    assert app.bus.handler_count(RefundProcessed) == 0
    register_handlers(app.bus, app.repositories, app.product_cache)
    app.bus.replay(events)
    assert app.bus.handler_count(RefundProcessed) == 1
    assert len(app.repositories.refund_postings) == 3
    assert RevenueReport(app.repositories).monthly(2026, 4)[0].refunds == Money(1250, currency)
print(scenario + ": API/CLI totals and single dispatch passed on two buses")
