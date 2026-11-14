from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from fulfil.models.money import Money
from fulfil.models.product import Sku


class ShipmentState(str, Enum):
    PENDING = "pending"
    LABELLED = "labelled"
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"


@dataclass
class BackorderRequest:
    request_id: str
    order_id: str
    sku: Sku
    quantity: int
    requested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    allocated: int = 0
    cancelled: int = 0

    def __post_init__(self) -> None:
        if self.quantity <= 0 or not 0 <= self.allocated + self.cancelled <= self.quantity:
            raise ValueError("backorder quantities are invalid")

    @property
    def remaining(self) -> int:
        return self.quantity - self.allocated - self.cancelled

    def allocate(self, quantity: int) -> int:
        if quantity <= 0:
            raise ValueError("allocation must be positive")
        actual = min(quantity, self.remaining)
        self.allocated += actual
        return actual

    def cancel(self, quantity: int) -> int:
        if quantity <= 0:
            raise ValueError("cancellation must be positive")
        actual = min(quantity, self.remaining)
        self.cancelled += actual
        return actual


@dataclass
class Shipment:
    shipment_id: str
    order_id: str
    carrier: str
    service: str
    tracking_number: str = ""
    state: ShipmentState = ShipmentState.PENDING
    label_created_at: datetime | None = None
    zone: str = "domestic"
    weight_grams: int = 0
    label_payload: dict[str, str] = field(default_factory=dict)

    def attach_label(self, tracking_number: str) -> None:
        if self.state != ShipmentState.PENDING or not tracking_number.strip():
            raise ValueError("shipment cannot accept this label")
        self.tracking_number = tracking_number.strip()
        self.label_created_at = datetime.now(timezone.utc)
        self.state = ShipmentState.LABELLED

    def mark_in_transit(self, carrier_scan: str = "") -> None:
        if self.state != ShipmentState.LABELLED:
            raise ValueError("shipment must be labelled before dispatch")
        self.state = ShipmentState.IN_TRANSIT
        if carrier_scan:
            self.label_payload["first_scan"] = carrier_scan

    def mark_delivered(self, delivered_at: datetime | None = None) -> None:
        if self.state != ShipmentState.IN_TRANSIT:
            raise ValueError("shipment must be in transit before delivery")
        self.state = ShipmentState.DELIVERED
        if delivered_at:
            self.label_payload["delivered_at"] = delivered_at.isoformat()

    def validate_label(self) -> bool:
        return self.state in {ShipmentState.LABELLED, ShipmentState.IN_TRANSIT, ShipmentState.DELIVERED} \
            and bool(self.tracking_number)

    def tracking_url(self) -> str:
        if not self.validate_label():
            raise ValueError("shipment has no valid tracking label")
        hosts = {"parcel-post": "https://tracking.example.test/parcel/",
                 "global-mail": "https://tracking.example.test/global/"}
        host = hosts.get(self.carrier, "https://tracking.example.test/lookup/")
        return host + self.tracking_number

    def estimate_arrival(self, shipped_at: datetime, business_days: int) -> datetime:
        if business_days < 0 or shipped_at.tzinfo is None:
            raise ValueError("arrival estimate inputs are invalid")
        current = shipped_at
        elapsed = 0
        while elapsed < business_days:
            current += timedelta(days=1)
            if current.weekday() < 5:
                elapsed += 1
        return current


@dataclass
class Refund:
    refund_id: str
    order_id: str
    amount: Money
    reason: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    processed: bool = False
    restocked: bool = False
    line_allocations: dict[str, int] = field(default_factory=dict)

    def mark_processed(self) -> None:
        if self.processed:
            raise ValueError("refund has already been processed")
        if self.amount.minor <= 0:
            raise ValueError("refund amount must be positive")
        self.processed = True

    def allocate_lines(self, allocations: dict[str, int]) -> None:
        if sum(allocations.values()) > self.amount.minor or any(value < 0 for value in allocations.values()):
            raise ValueError("refund line allocation exceeds the refund amount")
        self.line_allocations = dict(allocations)

    def mark_restocked(self) -> None:
        if not self.processed:
            raise ValueError("refund must be processed before returned stock is recorded")
        self.restocked = True

    def applies_to(self, order_id: str, sku: Sku | None = None) -> bool:
        if self.order_id != order_id:
            return False
        return sku is None or str(sku) in self.reason

    def receipt_label(self) -> str:
        return f"Refund {self.refund_id} for {self.order_id}: {self.amount.currency} {self.amount.minor / 100:.2f}"

    def outstanding(self, order_total: Money, previous_refunds: list["Refund"]) -> Money:
        if order_total.currency != self.amount.currency:
            raise ValueError("refund and order currencies differ")
        refunded = sum(row.amount.minor for row in previous_refunds if row.order_id == self.order_id)
        return Money(max(0, order_total.minor - refunded - self.amount.minor), self.amount.currency)
