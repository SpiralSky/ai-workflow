from fulfil.models import Customer, Order, Product, Refund, Shipment, Sku
from fulfil.storage.base import InMemoryRepository


class ProductRepository(InMemoryRepository[Product]):
    def __init__(self):
        super().__init__(lambda product: product.sku)

    def get(self, key: str | Sku) -> Product:
        return super().get(str(Sku(str(key))))

    def find(self, key: str | Sku) -> Product | None:
        return super().find(str(Sku(str(key))))

    def delete(self, key: str | Sku) -> bool:
        return super().delete(str(Sku(str(key))))

    def active_products(self) -> list[Product]:
        return [product for product in self.all() if product.active]

    def search(self, text: str) -> list[Product]:
        needle = text.strip().casefold()
        if not needle:
            return self.active_products()
        return [product for product in self.active_products()
                if needle in product.name.casefold() or needle in str(product.sku).casefold()
                or any(needle in tag.casefold() for tag in product.tags)]

    def below(self, level: int) -> list[Product]:
        if level < 0:
            raise ValueError("stock threshold cannot be negative")
        return [product for product in self.active_products() if product.stock_on_hand <= level]

    def get_by_sku(self, sku: Sku) -> Product:
        return self.get(str(sku))

    def sku_exists(self, sku: Sku, active_only: bool = False) -> bool:
        product = self.find(str(sku))
        return product is not None and (product.active or not active_only)


class CustomerRepository(InMemoryRepository[Customer]):
    def __init__(self):
        super().__init__(lambda customer: customer.customer_id)

    def by_email(self, email: str) -> Customer | None:
        normalized = email.strip().casefold()
        return next((c for c in self.all() if c.email.casefold() == normalized), None)

    def opted_in(self) -> list[Customer]:
        return [customer for customer in self.all() if customer.marketing_opt_in]

    def name_prefix(self, prefix: str) -> list[Customer]:
        start = prefix.strip().casefold()
        return sorted((customer for customer in self.all() if customer.name.casefold().startswith(start)),
                      key=lambda customer: customer.name.casefold())


class OrderRepository(InMemoryRepository[Order]):
    def __init__(self):
        super().__init__(lambda order: order.order_id)

    def for_customer(self, customer_id: str) -> list[Order]:
        return [order for order in self.all() if order.customer_id == customer_id]

    def by_status(self, status: str) -> list[Order]:
        return [order for order in self.all() if order.status.value == status]

    def recent(self, limit: int = 20) -> list[Order]:
        if limit <= 0:
            raise ValueError("limit must be positive")
        return sorted(self.all(), key=lambda order: order.created_at, reverse=True)[:limit]


class ShipmentRepository(InMemoryRepository[Shipment]):
    def __init__(self):
        super().__init__(lambda shipment: shipment.shipment_id)


class RefundRepository(InMemoryRepository[Refund]):
    def __init__(self):
        super().__init__(lambda refund: refund.refund_id)

    def for_order(self, order_id: str) -> list[Refund]:
        return [refund for refund in self.all() if refund.order_id == order_id]

    def unprocessed(self) -> list[Refund]:
        return [refund for refund in self.all() if not refund.processed]


class RepositorySet:
    def __init__(self):
        self.products = ProductRepository()
        self.customers = CustomerRepository()
        self.orders = OrderRepository()
        self.shipments = ShipmentRepository()
        self.refunds = RefundRepository()
        self.refund_postings = []
        self.refund_posting_keys = {}

    def clear(self) -> None:
        self.refund_postings.clear()
        for posted in self.refund_posting_keys.values():
            posted.clear()
        for repository in (self.products, self.customers, self.orders, self.shipments, self.refunds):
            repository.clear()

    def counts(self) -> dict[str, int]:
        return {name: getattr(self, name).count()
                for name in ("products", "customers", "orders", "shipments", "refunds")}

    def empty(self) -> bool:
        return not any(self.counts().values())
