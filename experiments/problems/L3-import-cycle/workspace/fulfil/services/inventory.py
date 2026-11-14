from fulfil.events.bus import EventBus
from fulfil.events.types import StockChanged
from fulfil.models.product import Product, Sku
from fulfil.models.fulfillment import BackorderRequest
from fulfil.models.order import Order
from fulfil.storage.repositories import RepositorySet
from fulfil.util.ids import new_id


class InventoryService:
    def __init__(self, repositories: RepositorySet, bus: EventBus):
        self.repositories = repositories
        self.bus = bus
        self._reservations: dict[str, dict[Sku, int]] = {}
        self._backorders: list[BackorderRequest] = []

    def reserve(self, order_id: str, requested: dict[Sku, int]) -> None:
        if order_id in self._reservations:
            raise ValueError("order already has a reservation")
        reserved: dict[Sku, int] = {}
        try:
            for sku, quantity in requested.items():
                if quantity <= 0:
                    raise ValueError("reservation quantities must be positive")
                product = self.repositories.products.get(str(sku))
                if not product.active or product.stock_on_hand < quantity:
                    raise ValueError(f"not enough available stock for {sku}")
                product.adjust_stock(-quantity)
                self.repositories.products.save(product)
                reserved[sku] = quantity
                self.bus.publish(StockChanged(str(sku), -quantity, f"reservation:{order_id}"))
        except Exception:
            for sku, quantity in reserved.items():
                product = self.repositories.products.get(str(sku))
                product.adjust_stock(quantity)
                self.repositories.products.save(product)
            raise
        self._reservations[order_id] = reserved

    def release(self, order_id: str) -> dict[Sku, int]:
        reserved = self._reservations.pop(order_id, {})
        for sku, quantity in reserved.items():
            product = self.repositories.products.get(str(sku))
            product.adjust_stock(quantity)
            self.repositories.products.save(product)
            self.bus.publish(StockChanged(str(sku), quantity, f"release:{order_id}"))
        for request in self._backorders:
            if request.order_id == order_id and request.remaining:
                request.cancel(request.remaining)
        self._backorders = [request for request in self._backorders if request.remaining]
        return reserved

    def restock(self, sku: Sku, quantity: int, note: str = "manual") -> Product:
        if quantity <= 0:
            raise ValueError("restock quantity must be positive")
        product = self.repositories.products.get(str(sku))
        product.adjust_stock(quantity)
        self.repositories.products.save(product)
        self.bus.publish(StockChanged(str(sku), quantity, f"restock:{note}"))
        self._allocate_backorders(sku)
        product = self.repositories.products.get(str(sku))
        return product

    def reservation(self, order_id: str) -> dict[Sku, int]:
        return dict(self._reservations.get(order_id, {}))

    def available(self, sku: Sku) -> int:
        product = self.repositories.products.get(str(sku))
        return product.stock_on_hand

    def reserve_from_lines(self, order_id: str, lines) -> dict[Sku, int]:
        requested: dict[Sku, int] = {}
        for line in lines:
            requested[line.sku] = requested.get(line.sku, 0) + line.quantity
        self.reserve(order_id, requested)
        return dict(requested)

    def release_product(self, sku: Sku, quantity: int, reason: str = "adjustment") -> Product:
        if quantity <= 0:
            raise ValueError("release quantity must be positive")
        product = self.repositories.products.get(str(sku))
        product.adjust_stock(-quantity)
        self.repositories.products.save(product)
        self.bus.publish(StockChanged(str(sku), -quantity, f"release:{reason}"))
        return product

    def set_active(self, sku: Sku, active: bool) -> Product:
        product = self.repositories.products.get(str(sku))
        product.active = bool(active)
        self.repositories.products.save(product)
        return product

    def reserve_with_backorders(self, order_id: str, requested: dict[Sku, int]) -> dict[Sku, int]:
        if order_id in self._reservations:
            raise ValueError("order already has a reservation")
        allocated: dict[Sku, int] = {}
        shortages: dict[Sku, int] = {}
        pending: list[BackorderRequest] = []
        for sku, quantity in requested.items():
            if quantity <= 0:
                raise ValueError("reservation quantities must be positive")
            product = self.repositories.products.get(str(sku))
            if not product.active:
                raise ValueError(f"product {sku} is inactive")
            available = product.stock_on_hand
            held = min(available, quantity)
            shortage = quantity - held
            if held:
                product.adjust_stock(-held)
                self.repositories.products.save(product)
                self.bus.publish(StockChanged(str(sku), -held, f"reservation:{order_id}"))
                allocated[sku] = held
            if shortage:
                request = BackorderRequest(new_id("bo"), order_id, sku, shortage)
                pending.append(request)
                shortages[sku] = shortage
        self._reservations[order_id] = allocated
        self._backorders.extend(pending)
        return shortages

    def release_units(self, order_id: str, sku: Sku, quantity: int) -> int:
        if quantity <= 0:
            raise ValueError("release quantity must be positive")
        reservations = self._reservations.get(order_id, {})
        held = reservations.get(sku, 0)
        pending = quantity
        for request in self._backorders:
            if request.order_id == order_id and request.sku == sku and request.remaining and pending:
                cancelled = min(pending, request.remaining)
                request.cancel(cancelled)
                pending -= cancelled
        self._backorders = [request for request in self._backorders if request.remaining]
        released = min(held, pending)
        if released:
            product = self.repositories.products.get(str(sku))
            product.adjust_stock(released)
            self.repositories.products.save(product)
            left = held - released
            if left:
                reservations[sku] = left
            else:
                reservations.pop(sku, None)
            self.bus.publish(StockChanged(str(sku), released, f"partial-release:{order_id}"))
        return released

    def adjust_reservation(self, order_id: str, requested: dict[Sku, int], allow_backorder: bool = False) -> dict[Sku, int]:
        current = dict(self._reservations.get(order_id, {}))
        skus = set(current) | set(requested)
        plan = {}
        for sku in skus:
            target = requested.get(sku, 0)
            if target < 0:
                raise ValueError("reservation quantities cannot be negative")
            held = current.get(sku, 0)
            queued = sum(request.remaining for request in self._backorders
                         if request.order_id == order_id and request.sku == sku)
            desired_queue = min(queued, target)
            desired_stock = target - desired_queue
            add = max(0, desired_stock - held)
            available = self.available(sku)
            if add > available and not allow_backorder:
                raise ValueError(f"not enough available stock for {sku}")
            actual_add = min(add, available)
            shortage = add - actual_add
            plan[sku] = {"held": held, "queued": queued, "desired_queue": desired_queue,
                         "desired_stock": desired_stock, "release": max(0, held - desired_stock),
                         "add": actual_add, "shortage": shortage}
        shortages = {}
        reservations = self._reservations.setdefault(order_id, {})
        for sku, changes in plan.items():
            cancel_pending = changes["queued"] - changes["desired_queue"]
            for request in reversed(self._backorders):
                if request.order_id == order_id and request.sku == sku and cancel_pending:
                    cancel_pending -= request.cancel(cancel_pending)
            if changes["release"]:
                product = self.repositories.products.get(str(sku))
                product.adjust_stock(changes["release"])
                self.repositories.products.save(product)
                self.bus.publish(StockChanged(str(sku), changes["release"], f"amend-release:{order_id}"))
            if changes["add"]:
                product = self.repositories.products.get(str(sku))
                product.adjust_stock(-changes["add"])
                self.repositories.products.save(product)
                self.bus.publish(StockChanged(str(sku), -changes["add"], f"amend-reservation:{order_id}"))
            if changes["desired_stock"]:
                reservations[sku] = changes["desired_stock"]
            else:
                reservations.pop(sku, None)
            if changes["shortage"]:
                self._backorders.append(BackorderRequest(new_id("bo"), order_id, sku, changes["shortage"]))
                shortages[sku] = changes["desired_queue"] + changes["shortage"]
        self._backorders = [request for request in self._backorders if request.remaining]
        return shortages

    def backorders(self, order_id: str | None = None) -> list[BackorderRequest]:
        rows = self._backorders
        if order_id is not None:
            rows = [request for request in rows if request.order_id == order_id]
        return list(rows)

    def _allocate_backorders(self, sku: Sku) -> int:
        product = self.repositories.products.get(str(sku))
        allocated_total = 0
        for request in self._backorders:
            if request.sku != sku or not request.remaining or product.stock_on_hand == 0:
                continue
            allocated = request.allocate(product.stock_on_hand)
            if not allocated:
                continue
            product.adjust_stock(-allocated)
            order = self.repositories.orders.find(request.order_id)
            if order:
                order.fulfill_backorder(sku, allocated)
                self.repositories.orders.save(order)
            held = self._reservations.setdefault(request.order_id, {})
            held[sku] = held.get(sku, 0) + allocated
            allocated_total += allocated
            self.bus.publish(StockChanged(str(sku), -allocated, f"backorder-allocation:{request.order_id}"))
        self._backorders = [request for request in self._backorders if request.remaining]
        if allocated_total:
            self.repositories.products.save(product)
        return allocated_total
