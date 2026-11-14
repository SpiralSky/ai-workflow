from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


@dataclass(frozen=True, order=True)
class Money:
    minor: int
    currency: str = "USD"

    def __post_init__(self) -> None:
        if self.currency not in {"USD", "EUR", "GBP"}:
            raise ValueError(f"unsupported currency: {self.currency}")
        if not isinstance(self.minor, int):
            raise TypeError("minor amount must be an integer")

    @classmethod
    def from_major(cls, value: Decimal | str | int, currency: str = "USD") -> "Money":
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        return cls(int(amount * 100), currency)

    @property
    def major(self) -> Decimal:
        return Decimal(self.minor) / 100

    def _same_currency(self, other: "Money") -> None:
        if self.currency != other.currency:
            raise ValueError(f"currency mismatch: {self.currency} and {other.currency}")

    def __add__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(self.minor + other.minor, self.currency)

    def __sub__(self, other: "Money") -> "Money":
        self._same_currency(other)
        return Money(self.minor - other.minor, self.currency)

    def __mul__(self, quantity: int) -> "Money":
        if not isinstance(quantity, int):
            return NotImplemented
        return Money(self.minor * quantity, self.currency)

    __rmul__ = __mul__

    def is_zero(self) -> bool:
        return self.minor == 0

    def absolute(self) -> "Money":
        return Money(abs(self.minor), self.currency)

    def clamp(self, minimum: "Money", maximum: "Money") -> "Money":
        self._same_currency(minimum)
        self._same_currency(maximum)
        if minimum.minor > maximum.minor:
            raise ValueError("minimum exceeds maximum")
        return Money(min(max(self.minor, minimum.minor), maximum.minor), self.currency)

    def percentage(self, basis_points: int) -> "Money":
        if basis_points < 0:
            raise ValueError("basis points cannot be negative")
        return Money((self.minor * basis_points + 5000) // 10000, self.currency)
