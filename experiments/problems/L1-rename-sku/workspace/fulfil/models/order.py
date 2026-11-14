from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from fulfil.models.money import Money
from fulfil.models.product import Sku


class OrderStatus(str, Enum):
    DRAFT = "draft"
    PLACED = "placed"
    PAID = "paid"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


@dataclass
class OrderLine:
    sku: Sku
    description: str
    quantity: int
    unit_price: Money
    discount: Money | None = None

    def __post_init__(self) -> None:
        if self.quantity <= 0:
            raise ValueError("line quantity must be positive")
        if self.discount and self.discount.currency != self.unit_price.currency:
            raise ValueError("discount currency differs from line price")

    @property
    def subtotal(self) -> Money:
        gross = self.unit_price * self.quantity
        return gross - (self.discount or Money(0, gross.currency))


@dataclass
class Order:
    order_id: str
    customer_id: str
    currency: str
    lines: list[OrderLine] = field(default_factory=list)
    status: OrderStatus = OrderStatus.DRAFT
    shipping_address: object | None = None
    shipping_fee: Money | None = None
    tax: Money | None = None
    tax_inclusive: bool = False
    backorder_lines: list["OrderLine"] = field(default_factory=list)
    cancellation_history: list[dict[str, str | int]] = field(default_factory=list)
    status_history: list[tuple[str, datetime]] = field(default_factory=list)
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    revision: int = 0
    metadata: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.currency not in {"USD", "EUR", "GBP"}:
            raise ValueError("unsupported order currency")

    def add_line(self, line: OrderLine) -> None:
        if line.unit_price.currency != self.currency:
            raise ValueError("line currency differs from order")
        self.lines.append(line)
        self.revision += 1

    def remove_sku(self, sku: Sku) -> None:
        before = len(self.lines)
        self.lines = [line for line in self.lines if line.sku != sku]
        if len(self.lines) == before:
            raise KeyError(str(sku))
        self.revision += 1

    @property
    def item_subtotal(self) -> Money:
        total = Money(0, self.currency)
        for line in self.lines:
            total += line.subtotal
        return total

    @property
    def total(self) -> Money:
        shipping = self.shipping_fee or Money(0, self.currency)
        tax = self.tax or Money(0, self.currency)
        value = self.item_subtotal + shipping
        return value if self.tax_inclusive else value + tax

    def transition(self, target: OrderStatus) -> None:
        allowed = {
            OrderStatus.DRAFT: {OrderStatus.PLACED, OrderStatus.CANCELLED},
            OrderStatus.PLACED: {OrderStatus.PAID, OrderStatus.CANCELLED},
            OrderStatus.PAID: {OrderStatus.FULFILLED, OrderStatus.REFUNDED},
            OrderStatus.FULFILLED: {OrderStatus.REFUNDED},
            OrderStatus.CANCELLED: set(),
            OrderStatus.REFUNDED: set(),
        }
        if target not in allowed[self.status]:
            raise ValueError(f"cannot move order from {self.status} to {target}")
        self.status = target
        self.revision += 1
        self.status_history.append((target.value, datetime.now(timezone.utc)))

    def line_for(self, sku: Sku) -> OrderLine | None:
        return next((line for line in self.lines if line.sku == sku), None)

    def quantity_for(self, sku: Sku) -> int:
        return sum(line.quantity for line in self.lines if line.sku == sku)

    def replace_quantity(self, sku: Sku, quantity: int) -> None:
        if self.status != OrderStatus.DRAFT:
            raise ValueError("only draft order lines can be changed")
        if quantity <= 0:
            self.remove_sku(sku)
            return
        line = self.line_for(sku)
        if line is None:
            raise KeyError(str(sku))
        line.quantity = quantity
        self.revision += 1

    def summary(self) -> dict[str, str | int]:
        return {"order_id": self.order_id, "customer_id": self.customer_id,
                "status": self.status.value, "currency": self.currency,
                "line_count": len(self.lines), "quantity": sum(line.quantity for line in self.lines),
                "total_minor": self.total.minor}

    def is_open(self) -> bool:
        return self.status in {OrderStatus.DRAFT, OrderStatus.PLACED}

    def can_amend(self) -> bool:
        return self.status in {OrderStatus.DRAFT, OrderStatus.PLACED}

    def can_refund(self) -> bool:
        return self.status in {OrderStatus.PAID, OrderStatus.FULFILLED}

    def total_quantity(self) -> int:
        return sum(line.quantity for line in self.lines)

    def tax_rate_basis_points(self) -> int:
        base = self.item_subtotal.minor
        if base == 0 or self.tax is None:
            return 0
        taxable = max(0, self.tax.minor)
        return (taxable * 10000 + base // 2) // base

    def set_note(self, key: str, value: str) -> None:
        clean_key = " ".join(key.split())
        clean_value = " ".join(value.split())
        if not clean_key or len(clean_key) > 40 or len(clean_value) > 250:
            raise ValueError("order note is invalid")
        self.metadata[clean_key] = clean_value
        self.revision += 1

    def cancel_reason(self, reason: str) -> None:
        if self.status in {OrderStatus.CANCELLED, OrderStatus.REFUNDED}:
            raise ValueError("closed order cannot receive a cancellation note")
        cleaned = " ".join(reason.split())
        if not cleaned:
            raise ValueError("cancellation reason is required")
        self.metadata["cancellation_reason"] = cleaned
        self.revision += 1

    def add_backorder_line(self, line: OrderLine) -> None:
        existing = next((row for row in self.backorder_lines if row.sku == line.sku), None)
        if existing:
            existing.quantity += line.quantity
        else:
            self.backorder_lines.append(line)
        self.revision += 1

    def fulfill_backorder(self, sku: Sku, quantity: int) -> int:
        if quantity <= 0:
            raise ValueError("fulfil quantity must be positive")
        line = next((row for row in self.backorder_lines if row.sku == sku), None)
        if line is None:
            return 0
        fulfilled = min(quantity, line.quantity)
        line.quantity -= fulfilled
        if line.quantity == 0:
            self.backorder_lines.remove(line)
        self.revision += 1
        return fulfilled

    def cancel_line_quantity(self, sku: Sku, quantity: int) -> OrderLine:
        if quantity <= 0:
            raise ValueError("cancellation quantity must be positive")
        line = self.line_for(sku)
        if line is None or quantity > line.quantity:
            raise ValueError("cancellation exceeds ordered quantity")
        waiting = next((row for row in self.backorder_lines if row.sku == sku), None)
        if waiting:
            waiting.quantity -= min(quantity, waiting.quantity)
            if waiting.quantity == 0:
                self.backorder_lines.remove(waiting)
        if quantity == line.quantity:
            self.lines.remove(line)
            cancelled = line
        else:
            cancelled_discount = ((line.discount.minor * quantity + line.quantity // 2) // line.quantity
                                  if line.discount else None)
            cancelled = OrderLine(line.sku, line.description, quantity, line.unit_price,
                                  Money(cancelled_discount, self.currency) if cancelled_discount is not None else None)
            line.quantity -= quantity
            if line.discount:
                line.discount -= cancelled.discount
        self.revision += 1
        return cancelled
