from dataclasses import dataclass
from fulfil.models.money import Money
from fulfil.models.product import Product
from fulfil.models.product import Sku
from fulfil.pricing import round_minor
from fulfil.storage.repositories import RepositorySet
from fulfil.util.money import format_money


@dataclass(frozen=True)
class StockRow:
    sku: str
    name: str
    on_hand: int
    unit_value_minor: int
    low: bool


class StockReport:
    def __init__(self, repositories: RepositorySet, low_stock_level: int = 5):
        self.repositories = repositories
        self.low_stock_level = low_stock_level

    def rows(self, include_inactive: bool = False) -> list[StockRow]:
        products = self.repositories.products.all()
        if not include_inactive:
            products = [product for product in products if product.active]
        products.sort(key=lambda product: (product.stock_on_hand, product.name.casefold()))
        return [StockRow(str(product.sku), product.name, product.stock_on_hand,
                         product.unit_price.minor * product.stock_on_hand,
                         product.stock_on_hand <= self.low_stock_level) for product in products]

    def low_stock(self) -> list[Product]:
        return self.repositories.products.below(self.low_stock_level)

    def value_by_currency(self) -> dict[str, int]:
        totals: dict[str, int] = {}
        for product in self.repositories.products.active_products():
            currency = product.unit_price.currency
            totals[currency] = totals.get(currency, 0) + product.stock_on_hand * product.unit_price.minor
        return totals

    def text(self, currency: str | None = None) -> str:
        rows = self.rows()
        if not rows:
            return "No active products"
        lines = ["SKU              PRODUCT                          QTY    VALUE"]
        for row in rows:
            product = self.repositories.products.get(row.sku)
            if currency and product.unit_price.currency != currency:
                continue
            value = product.unit_price * row.on_hand
            lines.append(f"{row.sku:16} {row.name[:32]:32} {row.on_hand:5}  {format_money(value)}")
        return "\n".join(lines)

    def replenishment(self, target_level: int = 20) -> list[tuple[str, int]]:
        if target_level < self.low_stock_level:
            raise ValueError("target level cannot be below the alert level")
        alert_skus = {str(product.sku) for product in self.low_stock()}
        candidates = [product for product in self.repositories.products.active_products()
                      if product.stock_on_hand < target_level]
        candidates.sort(key=lambda product: (str(product.sku) not in alert_skus,
                                             product.stock_on_hand, product.name.casefold()))
        return [(str(product.sku), target_level - product.stock_on_hand) for product in candidates]

    def for_sku(self, sku: Sku) -> StockRow | None:
        product = self.repositories.products.find(str(sku))
        if product is None:
            return None
        return StockRow(str(product.sku), product.name, product.stock_on_hand,
                        product.unit_price.minor * product.stock_on_hand,
                        product.stock_on_hand <= self.low_stock_level)

    def sku_count(self) -> int:
        return len({product.sku for product in self.repositories.products.active_products()})

    def average_unit_value_minor(self, currency: str) -> int:
        products = [product for product in self.repositories.products.active_products()
                    if product.unit_price.currency == currency and product.stock_on_hand]
        if not products:
            return 0
        weighted_value = sum(product.unit_price.minor * product.stock_on_hand for product in products)
        units = sum(product.stock_on_hand for product in products)
        return round_minor(weighted_value / units)

    def grouped_by_tag(self) -> dict[str, dict[str, int]]:
        values: dict[str, dict[str, int]] = {}
        for product in self.repositories.products.active_products():
            tags = product.tags or {"untagged"}
            for tag in tags:
                currency = product.unit_price.currency
                bucket = values.setdefault(tag.casefold(), {})
                bucket[currency] = bucket.get(currency, 0) + product.inventory_value().minor
        return values

    def report_value(self) -> str:
        totals = self.value_by_currency()
        if not totals:
            return "Inventory value: zero"
        return "Inventory value\n" + "\n".join(
            f"{currency}: {format_money(Money(amount, currency))}" for currency, amount in sorted(totals.items()))

    def restock_quantities(self, target_level: int = 20, pack_size: int = 1) -> dict[str, int]:
        if pack_size <= 0:
            raise ValueError("pack size must be positive")
        needed = self.replenishment(target_level)
        return {sku: ((quantity + pack_size - 1) // pack_size) * pack_size for sku, quantity in needed}
