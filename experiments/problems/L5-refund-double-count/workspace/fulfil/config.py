from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Settings:
    shop_name: str = "Northstar Shop"
    default_currency: str = "USD"
    tax_region: str = "US-CA"
    free_shipping_threshold: int = 7500
    reservation_minutes: int = 20
    notification_sender: str = "orders@example.test"
    service_fee_basis_points: int = 0
    accepted_currencies: tuple[str, ...] = ("USD", "EUR", "GBP")

    def __post_init__(self) -> None:
        if self.default_currency not in {"USD", "EUR", "GBP"}:
            raise ValueError("unsupported default currency")
        if self.free_shipping_threshold < 0:
            raise ValueError("free shipping threshold cannot be negative")
        if self.service_fee_basis_points < 0:
            raise ValueError("service fee cannot be negative")
        if self.default_currency not in self.accepted_currencies:
            raise ValueError("default currency is not in the accepted currency list")

    def with_currency(self, currency: str) -> "Settings":
        return Settings(self.shop_name, currency, self.tax_region, self.free_shipping_threshold,
                        self.reservation_minutes, self.notification_sender,
                        self.service_fee_basis_points, self.accepted_currencies)

    def validate(self) -> list[str]:
        issues = []
        if not self.shop_name.strip():
            issues.append("shop name is blank")
        if not 1 <= self.reservation_minutes <= 240:
            issues.append("reservation duration is outside the supported range")
        if "@" not in self.notification_sender:
            issues.append("notification sender must be an email address")
        return issues

    def shipping_is_free(self, subtotal_minor: int) -> bool:
        if subtotal_minor < 0:
            raise ValueError("subtotal cannot be negative")
        return subtotal_minor >= self.free_shipping_threshold

    @classmethod
    def from_mapping(cls, values: dict[str, object]) -> "Settings":
        known = {"shop_name", "default_currency", "tax_region", "free_shipping_threshold",
                 "reservation_minutes", "notification_sender", "service_fee_basis_points",
                 "accepted_currencies"}
        unknown = values.keys() - known
        if unknown:
            raise ValueError(f"unknown settings: {', '.join(sorted(unknown))}")
        data = dict(values)
        if "accepted_currencies" in data:
            data["accepted_currencies"] = tuple(data["accepted_currencies"])
        return cls(**data)

    def as_mapping(self) -> dict[str, object]:
        return {"shop_name": self.shop_name, "default_currency": self.default_currency,
                "tax_region": self.tax_region, "free_shipping_threshold": self.free_shipping_threshold,
                "reservation_minutes": self.reservation_minutes,
                "notification_sender": self.notification_sender,
                "service_fee_basis_points": self.service_fee_basis_points,
                "accepted_currencies": list(self.accepted_currencies)}

    def fee_for(self, subtotal_minor: int) -> int:
        if subtotal_minor < 0:
            raise ValueError("subtotal cannot be negative")
        return int(Decimal(subtotal_minor * self.service_fee_basis_points / 10000).quantize(Decimal("1")))

    def permits_currency(self, currency: str) -> bool:
        return currency.upper() in self.accepted_currencies
