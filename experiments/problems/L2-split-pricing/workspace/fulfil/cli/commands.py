from datetime import datetime, timezone
from fulfil.events.bus import EventBus
from fulfil.events.handlers import register_handlers
from fulfil.events.types import (
    CustomerAddressChanged, OrderCancelled, OrderPlaced, RefundProcessed,
    ShipmentLabelCreated, StockChanged, event_name,
)
from fulfil.models.money import Money
from fulfil.models.product import Sku
from fulfil.pricing import margin_percent, price_with_margin, price_with_markup, tax_for, tax_rate_for
from fulfil.reports.refunds import RefundReport
from fulfil.reports.revenue import RevenueReport
from fulfil.reports.stock import StockReport
from fulfil.storage.repositories import RepositorySet
from fulfil.services.inventory import InventoryService
from fulfil.services.refunds import RefundService
from fulfil.models.order import OrderStatus
from fulfil.reports.revenue import RevenueRow
from fulfil.util.money import format_money


class AdminCommands:
    def __init__(self, repositories: RepositorySet, bus: EventBus):
        self.repositories = repositories
        self.bus = register_handlers(bus, repositories)
        self.inventory = InventoryService(repositories, bus)
        self.refunds = RefundService(repositories, bus, self.inventory)

    def restock(self, sku: str, quantity: int, note: str = "admin") -> str:
        product = self.inventory.restock(Sku(sku), quantity, note)
        return f"Restocked {product.sku}: {product.stock_on_hand} on hand"

    def stock_report(self, low_stock_level: int = 5) -> str:
        rows = StockReport(self.repositories, low_stock_level).rows()
        if not rows:
            return "No active products"
        return "\n".join(f"{row.sku:16} {row.name:32} {row.on_hand:5} units" +
                         ("  LOW" if row.low else "") for row in rows)

    def revenue_report(self, year: int, month: int) -> str:
        return RevenueReport(self.repositories).text(year, month)

    def refund_report(self, order_id: str | None = None) -> str:
        rows = RefundReport(self.repositories).rows(order_id)
        if not rows:
            return "No refunds"
        return "\n".join(f"{row.refund_id} {row.order_id} {format_money(row.amount)} {row.reason}" for row in rows)

    def replay(self, events: list[object]) -> int:
        before = len(self.bus.history())
        for event in events:
            if not isinstance(event, (OrderPlaced, OrderCancelled, RefundProcessed, StockChanged,
                                      ShipmentLabelCreated, CustomerAddressChanged)):
                raise TypeError(f"unsupported replay event: {event_name(event)}")
        self.bus.replay(events)
        return len(self.bus.history()) - before

    def parse_date(self, value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed

    def product_lookup(self, sku: str) -> str:
        product = self.repositories.products.get(str(Sku(sku)))
        return f"{product.name} ({product.sku}): {format_money(product.unit_price)}; {product.stock_on_hand} units"

    def event_summary(self) -> str:
        subscriptions = self.bus.subscriptions()
        total = sum(subscriptions.values())
        return f"{total} handler(s) across {len(subscriptions)} event type(s); {len(self.bus.history())} event(s) recorded"

    def deactivate_product(self, sku: str) -> str:
        product = self.repositories.products.get(str(Sku(sku)))
        product.deactivate()
        self.repositories.products.save(product)
        return f"Disabled {product.sku} ({product.name})"

    def reactivate_product(self, sku: str) -> str:
        product = self.repositories.products.get(str(Sku(sku)))
        product.activate()
        self.repositories.products.save(product)
        return f"Enabled {product.sku} ({product.name})"

    def unprocessed_refunds(self) -> list[str]:
        return [refund.refund_id for refund in self.repositories.refunds.unprocessed()]

    def tax_estimate(self, subtotal_minor: int, currency: str, region: str) -> str:
        amount = tax_for(Money(subtotal_minor, currency), region)
        return f"Estimated tax: {format_money(amount)} ({region} at {tax_rate_for(region) * 100}%)"

    def markup_product(self, sku: str, markup_percent) -> str:
        product = self.repositories.products.get(str(Sku(sku)))
        product.change_price(price_with_markup(product.unit_price, markup_percent))
        self.repositories.products.save(product)
        return f"{product.sku} is now {format_money(product.unit_price)}"

    def set_target_margin(self, sku: str, cost: Money, margin) -> str:
        product = self.repositories.products.get(str(Sku(sku)))
        if cost.currency != product.unit_price.currency:
            raise ValueError("cost currency differs from product currency")
        product.change_price(price_with_margin(cost, margin))
        self.repositories.products.save(product)
        return f"{product.sku} target margin price is {format_money(product.unit_price)}"

    def margin_report(self, cost_by_sku: dict[str, Money]) -> dict[str, str]:
        output = {}
        for product in self.repositories.products.active_products():
            cost = cost_by_sku.get(str(product.sku))
            if cost is None or cost.currency != product.unit_price.currency:
                continue
            output[str(product.sku)] = f"{margin_percent(cost, product.unit_price)}%"
        return output

    def multi_currency_totals(self) -> str:
        values = {}
        for order in self.repositories.orders.all():
            values[order.currency] = values.get(order.currency, 0) + order.total.minor
        if not values:
            return "No order totals"
        return "\n".join(f"{currency}: {format_money(Money(total, currency))}"
                         for currency, total in sorted(values.items()))

    def refund(self, order_id: str, amount: Money | None = None,
               reason: str = "admin adjustment", restock: dict[str, int] | None = None) -> str:
        quantities = {Sku(sku): quantity for sku, quantity in (restock or {}).items()}
        result = self.refunds.issue(order_id, amount, reason, quantities)
        return f"Created {result.refund_id} for {format_money(result.amount)}"

    def sales_by_period(self, start: datetime, end: datetime, period: str = "month") -> str:
        grouped = RevenueReport(self.repositories).grouped(start, end, period)
        if not grouped:
            return "No sales in this range"
        lines = []
        for label, rows in sorted(grouped.items()):
            detail = ", ".join(f"{row.currency} {format_money(row.gross)}" for row in rows)
            lines.append(f"{label}: {detail}")
        return "\n".join(lines)

    def stock_value(self) -> str:
        return StockReport(self.repositories).report_value()

    def backorder_queue(self, order_id: str | None = None) -> list[str]:
        queue = []
        for order in self.repositories.orders.all():
            if order_id is not None and order.order_id != order_id:
                continue
            queue.extend(f"{order.order_id} {line.sku} x{line.quantity}" for line in order.backorder_lines)
        return queue

    def open_orders(self, customer_id: str | None = None) -> list[str]:
        orders = self.repositories.orders.all()
        if customer_id:
            orders = [order for order in orders if order.customer_id == customer_id]
        return [order.order_id for order in orders if order.status in {OrderStatus.DRAFT, OrderStatus.PLACED}]

    def shipment_queue(self) -> list[str]:
        return [f"{item.shipment_id} {item.order_id} {item.state.value}"
                for item in self.repositories.shipments.all()
                if item.state.value in {"pending", "labelled", "in_transit"}]

    def recent_orders(self, limit: int = 20) -> list[str]:
        return [order.order_id for order in self.repositories.orders.recent(limit)]

    def orders_by_status(self, status: str) -> list[str]:
        return [order.order_id for order in self.repositories.orders.by_status(status)]

    def marketing_recipients(self) -> list[str]:
        return [customer.email for customer in self.repositories.customers.opted_in()]
