from dataclasses import dataclass
from datetime import datetime
from fulfil.models.money import Money
from fulfil.models.product import Sku
from fulfil.util.dates import utc_now


@dataclass(frozen=True)
class OrderPlaced:
    order_id: str
    customer_id: str
    total: Money
    occurred_at: datetime = None

    def __post_init__(self):
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())


@dataclass(frozen=True)
class OrderCancelled:
    order_id: str
    reason: str
    occurred_at: datetime = None

    def __post_init__(self):
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())


@dataclass(frozen=True)
class RefundProcessed:
    refund_id: str
    order_id: str
    amount: Money
    occurred_at: datetime = None

    def __post_init__(self):
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())


@dataclass(frozen=True)
class StockChanged:
    sku: str
    delta: int
    reason: str
    occurred_at: datetime = None

    def __post_init__(self):
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())

    @property
    def product_code(self) -> Sku:
        return Sku(self.sku)


@dataclass(frozen=True)
class ShipmentLabelCreated:
    shipment_id: str
    order_id: str
    tracking_number: str
    carrier: str
    occurred_at: datetime = None

    def __post_init__(self):
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())


@dataclass(frozen=True)
class CustomerAddressChanged:
    customer_id: str
    address_index: int
    occurred_at: datetime = None

    def __post_init__(self):
        if self.address_index < 0:
            raise ValueError("address index cannot be negative")
        if self.occurred_at is None:
            object.__setattr__(self, "occurred_at", utc_now())


def event_name(event: object) -> str:
    return type(event).__name__
