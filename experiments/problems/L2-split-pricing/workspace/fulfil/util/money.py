from decimal import Decimal
from fulfil.models.money import Money


def format_money(amount: Money | Decimal | int | float | str) -> str:
    """Format a major-unit value for the shop's default USD display."""
    if isinstance(amount, Money):
        major = amount.major
    else:
        major = Decimal(str(amount))
    return f"${major:,.2f}"


def parse_money(text: str, currency: str = "USD") -> Money:
    cleaned = text.strip().replace(",", "").replace("$", "").replace("€", "").replace("£", "")
    if not cleaned:
        raise ValueError("amount is empty")
    return Money.from_major(cleaned, currency)


def sum_money(items: list[Money], currency: str | None = None) -> Money:
    if not items and currency is None:
        raise ValueError("currency is needed to sum an empty collection")
    unit = currency or items[0].currency
    total = Money(0, unit)
    for item in items:
        total += item
    return total
