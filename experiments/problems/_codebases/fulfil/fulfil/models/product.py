from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal

from fulfil.models.money import Money


@dataclass(frozen=True)
class Sku:
    value: str

    def __post_init__(self) -> None:
        normalized = self.value.strip().upper()
        if not normalized or len(normalized) > 32 or any(c.isspace() for c in normalized):
            raise ValueError("SKU must be a non-empty code of at most 32 characters")
        object.__setattr__(self, "value", normalized)

    def __str__(self) -> str:
        return self.value


@dataclass
class Product:
    sku: Sku
    name: str
    unit_price: Money
    stock_on_hand: int
    active: bool = True
    tags: set[str] = field(default_factory=set)
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    weight_grams: int = 250
    volume_cm3: int = 400
    tax_exempt_regions: set[str] = field(default_factory=set)
    break_quantities: tuple[int, ...] = ()
    break_discount_rate: Decimal = Decimal("0")

    def __post_init__(self) -> None:
        if not self.name.strip():
            raise ValueError("product name is required")
        if self.stock_on_hand < 0:
            raise ValueError("stock cannot be negative")
        if self.weight_grams < 0 or self.volume_cm3 < 0:
            raise ValueError("product dimensions cannot be negative")

    def adjust_stock(self, delta: int) -> int:
        updated = self.stock_on_hand + delta
        if updated < 0:
            raise ValueError("insufficient stock")
        self.stock_on_hand = updated
        self.updated_at = datetime.now(timezone.utc)
        return updated

    def change_price(self, amount: Money) -> None:
        if amount.currency != self.unit_price.currency:
            raise ValueError("price currency cannot change without migration")
        if amount.minor < 0:
            raise ValueError("price cannot be negative")
        self.unit_price = amount
        self.updated_at = datetime.now(timezone.utc)

    def has_tag(self, tag: str) -> bool:
        wanted = tag.strip().casefold()
        return any(existing.casefold() == wanted for existing in self.tags)

    def set_tags(self, tags: set[str]) -> None:
        cleaned = {tag.strip() for tag in tags if tag.strip()}
        if any(len(tag) > 40 for tag in cleaned):
            raise ValueError("product tags cannot exceed 40 characters")
        self.tags = cleaned
        self.updated_at = datetime.now(timezone.utc)

    def inventory_value(self) -> Money:
        return self.unit_price * self.stock_on_hand

    def can_fulfill(self, quantity: int) -> bool:
        return self.active and quantity > 0 and self.stock_on_hand >= quantity

    def deactivate(self) -> None:
        self.active = False
        self.updated_at = datetime.now(timezone.utc)

    def activate(self) -> None:
        self.active = True
        self.updated_at = datetime.now(timezone.utc)

    def is_tax_exempt(self, region: str) -> bool:
        return region.upper() in {item.upper() for item in self.tax_exempt_regions}

    def shipping_dimensions(self) -> tuple[int, int]:
        return self.weight_grams, self.volume_cm3

    def set_dimensions(self, weight_grams: int, volume_cm3: int) -> None:
        if min(weight_grams, volume_cm3) < 0:
            raise ValueError("product dimensions cannot be negative")
        self.weight_grams = weight_grams
        self.volume_cm3 = volume_cm3
        self.updated_at = datetime.now(timezone.utc)

    def set_quantity_breaks(self, quantities: tuple[int, ...], discount_rate: Decimal) -> None:
        if any(quantity <= 0 for quantity in quantities) or not Decimal(0) <= discount_rate < Decimal(1):
            raise ValueError("quantity price breaks are invalid")
        if len(set(quantities)) != len(quantities):
            raise ValueError("quantity break points must be unique")
        self.break_quantities = tuple(sorted(quantities))
        self.break_discount_rate = discount_rate
        self.updated_at = datetime.now(timezone.utc)
