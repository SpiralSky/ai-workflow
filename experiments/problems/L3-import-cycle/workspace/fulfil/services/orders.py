from fulfil.events.handlers import order_placed_event
from fulfil.events.bus import EventBus
from fulfil.events.types import OrderCancelled, OrderPlaced
from fulfil.models.customer import Address
from fulfil.models.order import Order, OrderLine, OrderStatus
from fulfil.models.product import Sku
from fulfil.pricing import (
    PriceBand, PriceBook, PriceQuote, PriceRule, PricingEngine, Promotion,
    compare_quotes, combine_duplicate_lines,
    price_for_product,
)
from fulfil.storage.repositories import RepositorySet
from fulfil.storage.uow import UnitOfWork
from fulfil.services.inventory import InventoryService
from fulfil.util.ids import new_id


class OrderService:
    def __init__(self, repositories: RepositorySet, inventory: InventoryService, bus: EventBus,
                 pricing: PricingEngine | None = None):
        self.repositories = repositories
        self.inventory = inventory
        self.bus = bus
        self.pricing = pricing or PricingEngine()

    def place(self, customer_id: str, lines: list[tuple[Sku, int]], currency: str = "USD",
              address: Address | None = None, promotion_code: str | None = None,
              allow_backorder: bool = False, coupons: list[str] | None = None) -> Order:
        customer = self.repositories.customers.get(customer_id)
        order = Order(new_id("ord"), customer_id, currency, shipping_address=address or customer.primary_address())
        requested: dict[Sku, int] = {}
        for sku, quantity in lines:
            product = self.repositories.products.get(str(sku))
            if product.unit_price.currency != currency:
                raise ValueError("product price is not available in requested currency")
            order.add_line(price_for_product(product, quantity, currency))
            requested[sku] = requested.get(sku, 0) + quantity
        order.lines = combine_duplicate_lines(order.lines)
        quote = self._quote(order, promotion_code, coupons=coupons)
        order.metadata["tax_region"] = self._region(order.shipping_address)
        order.lines = quote.lines
        order.shipping_fee = quote.shipping
        order.tax = quote.tax
        order.tax_inclusive = quote.tax_inclusive
        order.metadata["tax_region"] = self._region(order.shipping_address)
        if quote.promotion_code:
            order.metadata["promotion_code"] = quote.promotion_code
        try:
            if allow_backorder:
                shortages = self.inventory.reserve_with_backorders(order.order_id, requested)
                for sku, quantity in shortages.items():
                    line = next(line for line in order.lines if line.sku == sku)
                    order.add_backorder_line(OrderLine(line.sku, line.description, quantity, line.unit_price))
            else:
                self.inventory.reserve(order.order_id, requested)
        except Exception:
            if quote.promotion_code:
                selected = self.pricing.promotions.get(quote.promotion_code)
                if selected:
                    self.pricing.promotions.usage.release(selected)
            raise
        order.transition(OrderStatus.PLACED)
        with UnitOfWork(self.repositories) as work:
            work.add("orders", order)
            work.commit()
        self.bus.publish(order_placed_event(order))
        return order

    def cancel(self, order_id: str, reason: str = "customer request") -> Order:
        order = self.repositories.orders.get(order_id)
        if order.status in {OrderStatus.PAID, OrderStatus.FULFILLED}:
            raise ValueError("paid orders must be refunded")
        order.transition(OrderStatus.CANCELLED)
        self.inventory.release(order_id)
        order.backorder_lines.clear()
        code = order.metadata.pop("promotion_code", None)
        if code:
            promotion = self.pricing.promotions.get(code)
            if promotion:
                self.pricing.promotions.usage.release(promotion)
        with UnitOfWork(self.repositories) as work:
            work.save("orders", order)
            work.commit()
        self.bus.publish(OrderCancelled(order_id, reason))
        return order

    def amend(self, order_id: str, lines: list[tuple[Sku, int]], allow_backorder: bool = False) -> Order:
        order = self.repositories.orders.get(order_id)
        if order.status not in {OrderStatus.DRAFT, OrderStatus.PLACED}:
            raise ValueError("only draft and placed orders can be amended")
        replacement = []
        requested: dict[Sku, int] = {}
        for sku, quantity in lines:
            product = self.repositories.products.get(str(sku))
            if product.unit_price.currency != order.currency:
                raise ValueError("product price currency differs from order")
            replacement.append(price_for_product(product, quantity, order.currency))
            requested[sku] = requested.get(sku, 0) + quantity
        replacement = combine_duplicate_lines(replacement)
        if order.status == OrderStatus.PLACED:
            self.inventory.adjust_reservation(order_id, requested, allow_backorder)
            order.backorder_lines = []
            for request in self.inventory.backorders(order_id):
                line = next((row for row in replacement if row.sku == request.sku), None)
                if line:
                    order.add_backorder_line(OrderLine(request.sku, line.description,
                                                       request.remaining, line.unit_price))
        order.lines = replacement
        quote = self._quote(order)
        order.lines, order.shipping_fee, order.tax = quote.lines, quote.shipping, quote.tax
        order.tax_inclusive = quote.tax_inclusive
        order.revision += 1
        self.repositories.orders.save(order)
        return order

    def cancel_quantity(self, order_id: str, sku: Sku, quantity: int, reason: str = "line cancelled") -> Order:
        order = self.repositories.orders.get(order_id)
        if order.status not in {OrderStatus.DRAFT, OrderStatus.PLACED}:
            raise ValueError("only open orders support partial cancellation")
        if quantity <= 0 or quantity > order.quantity_for(sku):
            raise ValueError("cancellation exceeds ordered quantity")
        if order.status == OrderStatus.PLACED:
            self.inventory.release_units(order_id, sku, quantity)
        cancelled = order.cancel_line_quantity(sku, quantity)
        order.cancellation_history.append({"sku": str(sku), "quantity": quantity,
                                           "reason": " ".join(reason.split())})
        if order.status == OrderStatus.PLACED:
            quote = self._quote(order)
            order.lines, order.shipping_fee, order.tax = quote.lines, quote.shipping, quote.tax
            order.tax_inclusive = quote.tax_inclusive
            order.metadata["tax_region"] = self._region(order.shipping_address)
        self.repositories.orders.save(order)
        return order

    def mark_paid(self, order_id: str) -> Order:
        order = self.repositories.orders.get(order_id)
        order.transition(OrderStatus.PAID)
        self.repositories.orders.save(order)
        return order

    def mark_fulfilled(self, order_id: str) -> Order:
        order = self.repositories.orders.get(order_id)
        order.transition(OrderStatus.FULFILLED)
        self.repositories.orders.save(order)
        return order

    def recalculate(self, order_id: str, promotion_code: str | None = None, region: str = "US-CA") -> Order:
        order = self.repositories.orders.get(order_id)
        if order.status not in {OrderStatus.DRAFT, OrderStatus.PLACED}:
            raise ValueError("only open orders can be recalculated")
        quote = self._quote(order, promotion_code, region)
        order.lines, order.shipping_fee, order.tax = quote.lines, quote.shipping, quote.tax
        order.tax_inclusive = quote.tax_inclusive
        order.revision += 1
        self.repositories.orders.save(order)
        return order

    def order_history(self, customer_id: str) -> list[Order]:
        self.repositories.customers.get(customer_id)
        return sorted(self.repositories.orders.for_customer(customer_id),
                      key=lambda order: order.created_at, reverse=True)

    def compare_reprice(self, order_id: str) -> tuple[PriceQuote, int]:
        order = self.repositories.orders.get(order_id)
        current = PriceQuote(order.lines, order.shipping_fee or self.pricing.shipping_for(order.item_subtotal, order.currency),
                             order.tax or self.pricing.quote(order).tax, order.currency,
                             tax_inclusive=order.tax_inclusive)
        proposed = self._quote(order)
        return proposed, compare_quotes(proposed, current)

    def preview_rule(self, order_id: str, rule: PriceRule) -> PriceQuote:
        order = self.repositories.orders.get(order_id)
        return self.pricing.with_rule(rule).quote(order, region=self._region(order.shipping_address))

    def preview_promotion(self, order_id: str, promotion: Promotion) -> PriceQuote:
        order = self.repositories.orders.get(order_id)
        engine = self.pricing.with_promotion(promotion)
        return engine.quote(order, promotion_code=promotion.code,
                            region=self._region(order.shipping_address))

    def _region(self, address) -> str:
        if not isinstance(address, Address):
            return "US-CA"
        return {"US": "US-CA", "GB": "GB", "DE": "DE", "FR": "FR"}.get(address.country.upper(), "US-CA")

    def _quote(self, order: Order, promotion_code: str | None = None,
               region: str | None = None, coupons: list[str] | None = None) -> PriceQuote:
        selected_region = region or self._region(order.shipping_address)
        price_book = PriceBook()
        for line in order.lines:
            product = self.repositories.products.get(line.sku)
            if product.break_quantities:
                price_book.add_tiers(product.sku, product.unit_price, product.break_quantities,
                                     product.break_discount_rate)
        engine = self.pricing.with_price_book(price_book) if price_book.bands() else self.pricing
        exempt_skus = {line.sku for line in order.lines
                       if self.repositories.products.get(line.sku).is_tax_exempt(selected_region)}
        if exempt_skus:
            order.metadata["tax_exempt_skus"] = ",".join(sorted(str(sku) for sku in exempt_skus))
        else:
            order.metadata.pop("tax_exempt_skus", None)
        return engine.quote(order, promotion_code=promotion_code, region=selected_region,
                            coupons=coupons, exempt_skus=exempt_skus)
