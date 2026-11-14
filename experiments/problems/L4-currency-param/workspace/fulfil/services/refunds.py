from dataclasses import replace
from fulfil.events.bus import EventBus
from fulfil.events.types import RefundProcessed
from fulfil.models.fulfillment import Refund
from fulfil.models.money import Money
from fulfil.models.product import Sku
from fulfil.models.order import OrderStatus
from fulfil.pricing import cap_line_discount, discount_allocation
from fulfil.services.inventory import InventoryService
from fulfil.storage.repositories import RepositorySet
from fulfil.util.ids import new_id


class RefundService:
    def __init__(self, repositories: RepositorySet, bus: EventBus,
                 inventory: InventoryService | None = None):
        self.repositories = repositories
        self.bus = bus
        self.inventory = inventory or InventoryService(repositories, bus)

    def issue(self, order_id: str, amount: Money | None = None, reason: str = "returned goods",
              restock_quantities: dict[Sku, int] | None = None) -> Refund:
        order = self.repositories.orders.get(order_id)
        if order.status not in {OrderStatus.PAID, OrderStatus.FULFILLED, OrderStatus.REFUNDED}:
            raise ValueError("only paid orders can be refunded")
        prior_refunds = self.repositories.refunds.for_order(order_id)
        available = order.total.minor - sum(r.amount.minor for r in prior_refunds)
        refund_amount = amount or order.total
        if refund_amount.currency != order.currency or not 0 < refund_amount.minor <= available:
            raise ValueError("refund exceeds the remaining order balance")
        for sku, quantity in (restock_quantities or {}).items():
            if quantity <= 0 or quantity > order.quantity_for(sku):
                raise ValueError(f"restock quantity exceeds purchased quantity for {sku}")
        allocations = discount_allocation([replace(line, discount=None) for line in order.lines], refund_amount)
        capped = {}
        for index, line in enumerate(order.lines):
            key = f"{line.sku}#{index}"
            amount_for_line = allocations.get(key, 0)
            capped[key] = cap_line_discount(replace(line, discount=None),
                                             Money(amount_for_line, order.currency)).discount.minor
        refund = Refund(new_id("rfd"), order_id, refund_amount, reason)
        refund.allocate_lines(capped)
        self.repositories.refunds.add(refund)
        if (sum(item.amount.minor for item in prior_refunds) + refund_amount.minor == order.total.minor
                and order.status != OrderStatus.REFUNDED):
            order.transition(OrderStatus.REFUNDED)
            self.repositories.orders.save(order)
        self.bus.publish(RefundProcessed(refund.refund_id, order_id, refund_amount))
        for sku, quantity in (restock_quantities or {}).items():
            self.inventory.restock(sku, quantity, f"refund:{refund.refund_id}")
        if restock_quantities:
            refund = self.repositories.refunds.get(refund.refund_id)
            refund.mark_restocked()
            self.repositories.refunds.save(refund)
        return self.repositories.refunds.get(refund.refund_id)

    def partial(self, order_id: str, amount: Money, reason: str = "partial refund",
                restock_quantities: dict[Sku, int] | None = None) -> Refund:
        return self.issue(order_id, amount, reason, restock_quantities)

    def remaining_balance(self, order_id: str) -> Money:
        order = self.repositories.orders.get(order_id)
        refunded = sum(refund.amount.minor for refund in self.repositories.refunds.for_order(order_id))
        return Money(max(0, order.total.minor - refunded), order.currency)
