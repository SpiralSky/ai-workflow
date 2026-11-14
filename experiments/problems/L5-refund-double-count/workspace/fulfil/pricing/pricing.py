"""Pricing rules, promotion evaluation, tax calculation and currency rounding.

The shop keeps prices in minor currency units. Rules produce adjusted lines first,
promotions operate on those lines, and tax is calculated from the resulting taxable
base. Keeping these stages explicit makes quotes reproducible for invoices.
"""
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP, ROUND_DOWN, ROUND_UP
from typing import Iterable, Protocol

from fulfil.models.money import Money
from fulfil.models.order import Order, OrderLine
from fulfil.models.product import Product, Sku


# Rule definitions and eligibility
class PriceRule(Protocol):
    def apply(self, line: OrderLine, context: "PricingContext") -> OrderLine: ...


@dataclass(frozen=True)
class PricingContext:
    currency: str
    customer_id: str = ""
    region: str = "US-CA"
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    tags: frozenset[str] = frozenset()
    channel: str = "web"

    def __post_init__(self):
        if self.now.tzinfo is None:
            raise ValueError("pricing time must be timezone-aware")


@dataclass(frozen=True)
class MinimumQuantityRule:
    minimum: int
    percent_off: Decimal
    name: str = "volume"

    def __post_init__(self):
        if self.minimum < 2 or not Decimal(0) <= self.percent_off <= Decimal(100):
            raise ValueError("invalid quantity rule")

    def apply(self, line: OrderLine, context: PricingContext) -> OrderLine:
        if line.quantity < self.minimum:
            return line
        amount = percent_of(line.unit_price * line.quantity, self.percent_off)
        return replace(line, discount=_combine_discount(line, amount))


@dataclass(frozen=True)
class SkuPriceRule:
    sku: Sku
    price: Money
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    def applies(self, line: OrderLine, context: PricingContext) -> bool:
        if line.sku != self.sku or self.price.currency != context.currency:
            return False
        return rule_effective_date(self, context.now)

    def apply(self, line: OrderLine, context: PricingContext) -> OrderLine:
        if not self.applies(line, context):
            return line
        return replace(line, unit_price=self.price)


@dataclass(frozen=True)
class CategoryPriceRule:
    tag: str
    percent_off: Decimal
    applies_to_sale: bool = False

    def apply(self, line: OrderLine, context: PricingContext) -> OrderLine:
        if self.tag not in context.tags:
            return line
        if line.discount and not self.applies_to_sale:
            return line
        discount = percent_of(line.unit_price * line.quantity, self.percent_off)
        return replace(line, discount=_combine_discount(line, discount))


def _in_period(now: datetime, starts: datetime | None, ends: datetime | None) -> bool:
    return (starts is None or now >= starts) and (ends is None or now < ends)


def _combine_discount(line: OrderLine, additional: Money) -> Money:
    existing = line.discount or Money(0, additional.currency)
    combined = existing + additional
    gross = line.unit_price * line.quantity
    return Money(min(combined.minor, gross.minor), gross.currency)


def percent_of(amount: Money, percentage: Decimal | int | str) -> Money:
    percent = Decimal(str(percentage))
    if not Decimal(0) <= percent <= Decimal(100):
        raise ValueError("percentage must be between zero and one hundred")
    return Money(round_minor(Decimal(amount.minor) * percent / 100), amount.currency)


def apply_rules(lines: Iterable[OrderLine], rules: Iterable[PriceRule], context: PricingContext) -> list[OrderLine]:
    result = list(lines)
    for rule in rules:
        result = [rule.apply(line, context) for line in result]
    return result


def price_for_product(product: Product, quantity: int, currency: str | None = None) -> OrderLine:
    if quantity <= 0:
        raise ValueError("quantity must be positive")
    if currency and currency != product.unit_price.currency:
        raise ValueError("product has no price in requested currency")
    return OrderLine(product.sku, product.name, quantity, product.unit_price)


# Promotion definitions and selection
@dataclass(frozen=True)
class Promotion:
    code: str
    description: str
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    minimum_subtotal: Money | None = None
    customer_ids: frozenset[str] = frozenset()
    channels: frozenset[str] = frozenset({"web", "admin"})
    combinable: bool = False
    usage_limit: int | None = None
    usage_count: int = 0
    automatic: bool = False

    def normalized_code(self) -> str:
        return self.code.strip().upper()

    def eligible(self, subtotal: Money, context: PricingContext) -> bool:
        if promotion_is_expired(self, context.now) or not _in_period(context.now, self.starts_at, self.ends_at):
            return False
        if self.customer_ids and context.customer_id not in self.customer_ids:
            return False
        if context.channel not in self.channels:
            return False
        if self.usage_limit is not None and self.usage_count >= self.usage_limit:
            return False
        if self.minimum_subtotal and subtotal.currency != self.minimum_subtotal.currency:
            return False
        if self.minimum_subtotal and subtotal.minor < self.minimum_subtotal.minor:
            return False
        return True

    def discount(self, lines: list[OrderLine], context: PricingContext) -> list[OrderLine]:
        raise NotImplementedError


@dataclass(frozen=True)
class PercentageDiscount(Promotion):
    percentage: Decimal = Decimal("0")
    maximum_discount: Money | None = None
    include_sale_lines: bool = False

    def __post_init__(self):
        if not Decimal(0) <= self.percentage <= Decimal(100):
            raise ValueError("promotion percentage is out of range")

    def discount(self, lines: list[OrderLine], context: PricingContext) -> list[OrderLine]:
        eligible = [line for line in lines if self.include_sale_lines or not line.discount]
        _, savings = discount_percent(eligible, self.percentage)
        amount = savings.minor
        if self.maximum_discount:
            if self.maximum_discount.currency != context.currency:
                raise ValueError("maximum discount has a different currency")
            amount = min(amount, self.maximum_discount.minor)
        return allocate_discount(lines, amount, context.currency, eligible=eligible)


@dataclass(frozen=True)
class FixedDiscount(Promotion):
    amount: Money = field(default_factory=lambda: Money(0))
    eligible_skus: frozenset[Sku] = frozenset()

    def discount(self, lines: list[OrderLine], context: PricingContext) -> list[OrderLine]:
        if self.amount.currency != context.currency:
            raise ValueError("fixed discount has a different currency")
        eligible = [line for line in lines if not self.eligible_skus or line.sku in self.eligible_skus]
        return allocate_discount(lines, self.amount.minor, context.currency, eligible=eligible)


@dataclass(frozen=True)
class BuyXGetY(Promotion):
    buy_quantity: int = 1
    free_quantity: int = 1
    eligible_skus: frozenset[Sku] = frozenset()

    def __post_init__(self):
        if self.buy_quantity <= 0 or self.free_quantity <= 0:
            raise ValueError("promotion quantities must be positive")

    def discount(self, lines: list[OrderLine], context: PricingContext) -> list[OrderLine]:
        updated = list(lines)
        for index, line in enumerate(updated):
            if self.eligible_skus and line.sku not in self.eligible_skus:
                continue
            groups = line.quantity // (self.buy_quantity + self.free_quantity)
            free_units = groups * self.free_quantity
            if free_units:
                updated[index] = replace(line, discount=_combine_discount(line, line.unit_price * free_units))
        return updated


def allocate_discount(lines: list[OrderLine], amount: int, currency: str,
                      eligible: list[OrderLine] | None = None) -> list[OrderLine]:
    """Allocate a fixed minor-unit discount proportionally without exceeding line totals."""
    result = list(lines)
    allowed_ids = {id(line) for line in (eligible if eligible is not None else lines)}
    indexes = [i for i, line in enumerate(lines) if id(line) in allowed_ids and line.subtotal.minor > 0]
    capacity = sum(lines[i].subtotal.minor for i in indexes)
    remaining = min(max(0, amount), capacity)
    if remaining == 0 or not indexes:
        return result
    shares = []
    for index in indexes:
        base = lines[index].subtotal.minor
        raw = Decimal(remaining) * base / capacity
        shares.append([index, int(raw), raw - int(raw)])
    assigned = sum(row[1] for row in shares)
    for row in sorted(shares, key=lambda part: part[2], reverse=True)[:remaining - assigned]:
        row[1] += 1
    for index, share, _ in shares:
        line = result[index]
        result[index] = replace(line, discount=_combine_discount(line, Money(share, currency)))
    return result


class PromotionBook:
    def __init__(self, promotions: Iterable[Promotion] = ()):
        self._promotions: dict[str, Promotion] = {}
        self.usage = PromotionUsage()
        for promotion in promotions:
            self.add(promotion)

    def add(self, promotion: Promotion) -> None:
        code = promotion.normalized_code()
        if not code:
            raise ValueError("promotion code is required")
        if code in self._promotions:
            raise ValueError(f"promotion {code} already exists")
        self._promotions[code] = promotion

    def get(self, code: str) -> Promotion | None:
        return self._promotions.get(code.strip().upper())

    def evaluate(self, code: str | None, lines: list[OrderLine], context: PricingContext) -> tuple[list[OrderLine], Promotion | None]:
        if not code:
            return list(lines), None
        promotion = self.get(code)
        if promotion is None:
            raise ValueError("promotion code is not recognized")
        subtotal = total_lines(lines)
        if promotion.minimum_subtotal and not basket_minimum(lines, promotion.minimum_subtotal):
            raise ValueError("order does not meet the promotion minimum")
        if not promotion.eligible(subtotal, context):
            raise ValueError("promotion is not available for this order")
        if not self.usage.available(promotion):
            raise ValueError("promotion usage limit has been reached")
        discounted = promotion.discount(lines, context)
        self.usage.claim(promotion)
        return discounted, promotion

    def all(self) -> list[Promotion]:
        return list(self._promotions.values())

    def automatic(self) -> list[Promotion]:
        return [promotion for promotion in self._promotions.values()
                if promotion.automatic and self.usage.available(promotion)]


# Tax policy and regional calculation
@dataclass(frozen=True)
class TaxPolicy:
    region: str
    rate: Decimal
    shipping_taxable: bool = False
    tax_inclusive: bool = False
    exempt_tags: frozenset[str] = frozenset()

    def __post_init__(self):
        if not Decimal(0) <= self.rate <= Decimal("1"):
            raise ValueError("tax rate must be between zero and one")

    def calculate(self, subtotal: Money, shipping: Money | None = None) -> Money:
        if shipping and shipping.currency != subtotal.currency:
            raise ValueError("shipping currency differs from subtotal")
        base = subtotal.minor
        if self.shipping_taxable and shipping:
            base += shipping.minor
        if self.tax_inclusive:
            tax = tax_included_amount(Money(base, subtotal.currency), self).minor
        else:
            tax = Decimal(base) * self.rate
        return Money(round_minor(tax), subtotal.currency)


DEFAULT_TAX_POLICIES = {
    "US-CA": TaxPolicy("US-CA", Decimal("0.0825"), shipping_taxable=False),
    "US-NY": TaxPolicy("US-NY", Decimal("0.08875"), shipping_taxable=True),
    "US-OR": TaxPolicy("US-OR", Decimal("0")),
    "GB": TaxPolicy("GB", Decimal("0.20"), tax_inclusive=True),
    "DE": TaxPolicy("DE", Decimal("0.19"), tax_inclusive=True),
    "FR": TaxPolicy("FR", Decimal("0.20"), tax_inclusive=True),
}


def tax_for(subtotal: Money, region: str, shipping: Money | None = None,
            policies: dict[str, TaxPolicy] | None = None) -> Money:
    selected = (policies or DEFAULT_TAX_POLICIES).get(region)
    if selected is None:
        raise ValueError(f"no tax policy for region {region}")
    return selected.calculate(subtotal, shipping)


def taxable_subtotal(lines: Iterable[OrderLine], exempt_skus: set[Sku] | None = None) -> Money:
    rows = list(lines)
    if not rows:
        return Money(0)
    excluded = exempt_skus or set()
    return Money(sum(line.subtotal.minor for line in rows if line.sku not in excluded), rows[0].unit_price.currency)


def calculate_tax_by_line(lines: Iterable[OrderLine], policy: TaxPolicy) -> dict[Sku, Money]:
    totals: dict[Sku, Money] = {}
    for line in lines:
        tax = Money(round_minor(Decimal(line.subtotal.minor) * policy.rate), line.subtotal.currency)
        totals[line.sku] = totals.get(line.sku, Money(0, tax.currency)) + tax
    return totals


# Quote assembly and rounding utilities
@dataclass(frozen=True)
class PriceQuote:
    lines: list[OrderLine]
    shipping: Money
    tax: Money
    currency: str
    promotion_code: str | None = None
    promotion_savings: Money = field(default_factory=lambda: Money(0))
    notes: tuple[str, ...] = ()
    tax_inclusive: bool = False

    @property
    def subtotal(self) -> Money:
        return total_lines(self.lines)

    @property
    def total(self) -> Money:
        gross = self.subtotal + self.shipping
        return gross if self.tax_inclusive else gross + self.tax


def total_lines(lines: Iterable[OrderLine]) -> Money:
    rows = list(lines)
    currency = rows[0].unit_price.currency if rows else "USD"
    total = Money(0, currency)
    for line in rows:
        total += line.subtotal
    return total


def round_minor(value: Decimal | int | str, mode: str = "half_up") -> int:
    modes = {"half_up": ROUND_HALF_UP, "down": ROUND_DOWN, "up": ROUND_UP}
    if mode not in modes:
        raise ValueError(f"unknown rounding mode: {mode}")
    return int(Decimal(value).quantize(Decimal("1"), rounding=modes[mode]))


def round_to_increment(amount: Money, increment: int, mode: str = "half_up") -> Money:
    if increment <= 0:
        raise ValueError("rounding increment must be positive")
    units = Decimal(amount.minor) / increment
    return Money(round_minor(units, mode) * increment, amount.currency)


def split_minor(amount: Money, weights: list[int]) -> list[Money]:
    if any(weight < 0 for weight in weights):
        raise ValueError("weights cannot be negative")
    total_weight = sum(weights)
    if not weights:
        return []
    if total_weight == 0:
        raise ValueError("at least one weight must be positive")
    portions = [amount.minor * weight // total_weight for weight in weights]
    remainder = amount.minor - sum(portions)
    for index in range(remainder):
        portions[index % len(portions)] += 1
    return [Money(part, amount.currency) for part in portions]


class PricingEngine:
    def __init__(self, rules: Iterable[PriceRule] = (), promotions: PromotionBook | None = None,
                 policies: dict[str, TaxPolicy] | None = None, free_shipping_threshold: int = 7500,
                 price_book=None, maximum_cart_discount: Money | None = None):
        if free_shipping_threshold < 0:
            raise ValueError("free shipping threshold cannot be negative")
        self.rules = list(rules)
        self.promotions = promotions or PromotionBook()
        self.policies = merge_tax_policies(DEFAULT_TAX_POLICIES, policies or {})
        self.free_shipping_threshold = free_shipping_threshold
        self.price_book = price_book
        self.maximum_cart_discount = maximum_cart_discount
        problems = validate_rule_set(self.rules)
        if problems:
            raise ValueError("invalid pricing rules: " + "; ".join(problems))

    def quote(self, order: Order, promotion_code: str | None = None, region: str = "US-CA",
              shipping: Money | None = None, customer_id: str | None = None,
              at: datetime | None = None, tags: frozenset[str] = frozenset(),
              channel: str = "web", coupons: list[str] | None = None,
              exempt_skus: set[Sku] | None = None) -> PriceQuote:
        context = PricingContext(order.currency, customer_id or order.customer_id, region,
                                 at or datetime.now(timezone.utc), tags, channel)
        lines = combine_duplicate_lines(order.lines)
        if self.price_book:
            tiered = []
            for line in lines:
                tier_price = self.price_book.price(line.sku, line.quantity, when=context.now)
                tiered.append(replace(line, unit_price=tier_price) if tier_price else line)
            lines = tiered
        lines = apply_rules(lines, self.rules, context)
        before_promo = total_lines(lines)
        selected_codes = list(coupons or ([] if not promotion_code else [promotion_code]))
        if len(selected_codes) == 1:
            lines, promotion = self.promotions.evaluate(
                normalize_promotion_code(selected_codes[0]), lines, context)
            selected_promotions = [promotion] if promotion else []
        elif selected_codes:
            selected_promotions = []
            for code in selected_codes:
                normalized = normalize_promotion_code(code)
                promotion = self.promotions.get(normalized)
                if promotion is None or not promotion.eligible(before_promo, context):
                    raise ValueError("promotion is not available for this order")
                selected_promotions.append(promotion)
            lines = apply_coupon_stack(lines, selected_promotions, context, discount_basis(lines))
            for selected in selected_promotions:
                self.promotions.usage.claim(selected)
            promotion = selected_promotions[0]
        else:
            lines, promotion = best_single_promotion(lines, self.promotions.automatic(), context)
            selected_promotions = [promotion] if promotion else []
            if promotion:
                self.promotions.usage.claim(promotion)
        if self.maximum_cart_discount and discount_over_limit(lines, self.maximum_cart_discount):
            lines = cart_discount_cap([replace(line, discount=None) for line in lines], Decimal(100),
                                      self.maximum_cart_discount)
        subtotal = total_lines(lines)
        shipping_amount = shipping or self.shipping_for(subtotal, order.currency)
        if shipping_amount.currency != order.currency:
            raise ValueError("shipping currency differs from order")
        policy = self.policies.get(region)
        if policy is None:
            raise ValueError(f"no tax policy for region {region}")
        exempt = exempt_skus or set()
        taxable_lines = [line for line in lines if not line_is_tax_exempt(line, exempt)]
        tax, _ = tax_summary(taxable_lines, policy)
        if policy.shipping_taxable and shipping_amount.minor:
            tax += shipping_tax(policy, shipping_amount)
        savings = promotion_savings([replace(line, discount=None) for line in lines], lines)
        if before_promo.minor < total_lines([replace(line, discount=None) for line in lines]).minor:
            savings = Money(max(0, before_promo.minor - subtotal.minor), order.currency)
        notes = (f"promotion:{promotion.normalized_code()}",) if promotion else ()
        if exempt:
            notes += (f"tax_exempt_lines:{len(exempt)}",)
        return PriceQuote(lines, shipping_amount, tax, order.currency,
                          promotion.normalized_code() if promotion else None, savings, notes,
                          policy.tax_inclusive)

    def shipping_for(self, subtotal: Money, currency: str) -> Money:
        if subtotal.currency != currency:
            raise ValueError("subtotal currency differs from requested shipping currency")
        standard = Money(595, currency)
        express = Money(1295, currency)
        threshold = Money(self.free_shipping_threshold, currency)
        return choose_shipping_rate(subtotal, standard, express, threshold)

    def with_rule(self, rule: PriceRule) -> "PricingEngine":
        return PricingEngine([*self.rules, rule], self.promotions, self.policies, self.free_shipping_threshold,
                             self.price_book, self.maximum_cart_discount)

    def with_promotion(self, promotion: Promotion) -> "PricingEngine":
        book = PromotionBook(self.promotions.all())
        book.add(promotion)
        return PricingEngine(self.rules, book, self.policies, self.free_shipping_threshold,
                             self.price_book, self.maximum_cart_discount)

    def with_price_book(self, price_book: "PriceBook") -> "PricingEngine":
        return PricingEngine(self.rules, self.promotions, self.policies, self.free_shipping_threshold,
                             price_book, self.maximum_cart_discount)

    def explain(self, order: Order, promotion_code: str | None = None, region: str = "US-CA") -> list[str]:
        quote = self.quote(order, promotion_code, region)
        detail = [f"{line.sku}: {line.quantity} x {line.unit_price.minor} {line.unit_price.currency}"
                  for line in quote.lines]
        detail.extend([f"items={quote.subtotal.minor}", f"shipping={quote.shipping.minor}",
                       f"tax={quote.tax.minor}", f"total={quote.total.minor}"])
        detail.extend(quote.notes)
        return detail


def price_breaks(unit_price: Money, quantities: Iterable[int], discount_per_tier: Decimal) -> dict[int, Money]:
    if not Decimal(0) <= discount_per_tier < Decimal(1):
        raise ValueError("tier discount rate must be between zero and one")
    result = {}
    for quantity in sorted(set(quantities)):
        if quantity <= 0:
            raise ValueError("break quantities must be positive")
        effective = max(Decimal(0), Decimal(1) - discount_per_tier * max(0, quantity - 1))
        result[quantity] = Money(round_minor(unit_price.minor * effective), unit_price.currency)
    return result


def compare_quotes(left: PriceQuote, right: PriceQuote) -> int:
    if left.currency != right.currency:
        raise ValueError("quotes must use the same currency")
    return (left.total.minor > right.total.minor) - (left.total.minor < right.total.minor)


def effective_unit_price(line: OrderLine) -> Money:
    gross = line.unit_price.minor * line.quantity
    net = line.subtotal.minor
    return Money(round_minor(Decimal(net) / line.quantity), line.unit_price.currency)


def apply_coupon_stack(lines: list[OrderLine], promotions: list[Promotion], context: PricingContext,
                       subtotal: Money | None = None) -> list[OrderLine]:
    current = list(lines)
    if len(promotions) > 1 and any(not promo.combinable for promo in promotions):
        raise ValueError("selected promotions cannot be combined")
    for promo in promotions:
        before = total_lines(current)
        if not promo.eligible(subtotal or before, context):
            raise ValueError(f"promotion {promo.code} is not eligible")
        if promo.minimum_subtotal and not basket_minimum(current, promo.minimum_subtotal):
            raise ValueError(f"promotion {promo.code} minimum was not reached")
        current = promo.discount(current, context)
    return current


def currency_increment(currency: str) -> int:
    increments = {"USD": 1, "EUR": 1, "GBP": 1}
    try:
        return increments[currency]
    except KeyError:
        raise ValueError(f"unsupported currency: {currency}") from None


def normalize_promotion_code(code: str) -> str:
    normalized = "".join(code.upper().split())
    if not normalized or len(normalized) > 24 or not normalized.isascii() or not normalized.isalnum():
        raise ValueError("promotion code must be up to 24 letters or digits")
    return normalized


def shipping_tax(policy: TaxPolicy, shipping: Money) -> Money:
    if not policy.shipping_taxable:
        return Money(0, shipping.currency)
    return Money(round_minor(Decimal(shipping.minor) * policy.rate), shipping.currency)


def discount_percent(lines: list[OrderLine], percent: Decimal) -> tuple[list[OrderLine], Money]:
    total = total_lines(lines)
    savings = percent_of(total, percent)
    return allocate_discount(lines, savings.minor, total.currency), savings


def validate_quote(quote: PriceQuote) -> None:
    if quote.shipping.currency != quote.currency or quote.tax.currency != quote.currency:
        raise ValueError("quote contains mixed currencies")
    if any(line.unit_price.currency != quote.currency for line in quote.lines):
        raise ValueError("quote line contains a different currency")
    if quote.subtotal.minor < 0 or quote.shipping.minor < 0 or quote.tax.minor < 0:
        raise ValueError("quote contains a negative total")


@dataclass(frozen=True)
class PriceBand:
    minimum_quantity: int
    unit_price: Money
    customer_group: str = "retail"
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    def matches(self, quantity: int, group: str, when: datetime) -> bool:
        return (quantity >= self.minimum_quantity and group == self.customer_group
                and _in_period(when, self.starts_at, self.ends_at))


class PriceBook:
    """Quantity and audience price bands indexed by product code."""
    def __init__(self):
        self._bands: dict[Sku, list[PriceBand]] = {}

    def add(self, sku: Sku, band: PriceBand) -> None:
        bands = self._bands.setdefault(sku, [])
        if any(existing.minimum_quantity == band.minimum_quantity
               and existing.customer_group == band.customer_group for existing in bands):
            raise ValueError("price band already exists at this quantity and group")
        if bands and bands[0].unit_price.currency != band.unit_price.currency:
            raise ValueError("price book cannot mix currencies for a product")
        bands.append(band)
        bands.sort(key=lambda item: (item.customer_group, item.minimum_quantity))

    def add_tiers(self, sku: Sku, base_price: Money, quantities: Iterable[int],
                  discount_per_tier: Decimal, group: str = "retail") -> list[PriceBand]:
        created = []
        for quantity, price in price_breaks(base_price, quantities, discount_per_tier).items():
            band = PriceBand(quantity, price, group)
            self.add(sku, band)
            created.append(band)
        return created

    def price(self, sku: Sku, quantity: int, group: str = "retail", when: datetime | None = None) -> Money | None:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        at = when or datetime.now(timezone.utc)
        candidates = [band for band in self._bands.get(sku, ()) if band.matches(quantity, group, at)]
        if not candidates:
            return None
        return max(candidates, key=lambda item: item.minimum_quantity).unit_price

    def bands(self, sku: Sku | None = None) -> list[tuple[Sku, PriceBand]]:
        selected = self._bands.items() if sku is None else [(sku, self._bands.get(sku, []))]
        return [(code, band) for code, bands in selected for band in bands]

    def remove(self, sku: Sku, customer_group: str, minimum_quantity: int) -> bool:
        bands = self._bands.get(sku)
        if not bands:
            return False
        remaining = [band for band in bands if not (band.customer_group == customer_group
                                                     and band.minimum_quantity == minimum_quantity)]
        if len(remaining) == len(bands):
            return False
        if remaining:
            self._bands[sku] = remaining
        else:
            del self._bands[sku]
        return True


@dataclass
class PromotionUsage:
    """Small in-process counter for usage-limited campaign codes."""
    counts: dict[str, int] = field(default_factory=dict)

    def used(self, promotion: Promotion) -> int:
        return self.counts.get(promotion.normalized_code(), promotion.usage_count)

    def available(self, promotion: Promotion) -> bool:
        return promotion.usage_limit is None or self.used(promotion) < promotion.usage_limit

    def claim(self, promotion: Promotion) -> int:
        if not self.available(promotion):
            raise ValueError("promotion usage limit has been reached")
        code = promotion.normalized_code()
        self.counts[code] = self.used(promotion) + 1
        return self.counts[code]

    def release(self, promotion: Promotion) -> int:
        code = promotion.normalized_code()
        current = self.used(promotion)
        if current <= promotion.usage_count:
            return current
        self.counts[code] = current - 1
        return self.counts[code]


def compare_unit_prices(left: Money, left_quantity: int, right: Money, right_quantity: int) -> int:
    if left.currency != right.currency:
        raise ValueError("prices must use the same currency")
    if left_quantity <= 0 or right_quantity <= 0:
        raise ValueError("comparison quantities must be positive")
    left_total = left.minor * right_quantity
    right_total = right.minor * left_quantity
    return (left_total > right_total) - (left_total < right_total)


def cart_discount_cap(lines: Iterable[OrderLine], percentage: Decimal, cap: Money) -> list[OrderLine]:
    rows = list(lines)
    if not rows:
        return rows
    if rows[0].unit_price.currency != cap.currency:
        raise ValueError("cap currency differs from cart")
    wanted = percent_of(total_lines(rows), percentage).minor
    return allocate_discount(rows, min(wanted, cap.minor), cap.currency)


def line_discount_for_display(line: OrderLine) -> str:
    if line.discount is None or line.discount.minor == 0:
        return "no discount"
    gross = line.unit_price.minor * line.quantity
    percent = Decimal(line.discount.minor) * 100 / gross if gross else Decimal(0)
    return f"{percent.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)}% off"


def price_with_margin(cost: Money, margin_percent: Decimal) -> Money:
    if margin_percent < 0:
        raise ValueError("margin cannot be negative")
    if margin_percent >= 100:
        raise ValueError("margin must be below one hundred percent")
    price = Decimal(cost.minor) / (Decimal(1) - margin_percent / 100)
    return Money(round_minor(price), cost.currency)


def price_with_markup(cost: Money, markup_percent: Decimal) -> Money:
    if markup_percent < 0:
        raise ValueError("markup cannot be negative")
    return Money(round_minor(Decimal(cost.minor) * (Decimal(1) + markup_percent / 100)), cost.currency)


def margin_percent(cost: Money, price: Money) -> Decimal:
    if cost.currency != price.currency:
        raise ValueError("cost and price currencies differ")
    if price.minor <= 0:
        raise ValueError("price must be positive")
    return (Decimal(price.minor - cost.minor) * 100 / price.minor).quantize(Decimal("0.01"))


def basket_minimum(lines: Iterable[OrderLine], minimum: Money) -> bool:
    total = total_lines(lines)
    if total.currency != minimum.currency:
        return False
    return total.minor >= minimum.minor


def percentage_of_tax_inclusive(amount: Money, rate: Decimal) -> Money:
    if not Decimal(0) <= rate <= Decimal(1):
        raise ValueError("tax rate must be between zero and one")
    tax = Decimal(amount.minor) - Decimal(amount.minor) / (Decimal(1) + rate)
    return Money(round_minor(tax), amount.currency)


def tax_summary(lines: Iterable[OrderLine], policy: TaxPolicy) -> tuple[Money, dict[Sku, Money]]:
    rows = list(lines)
    total = apply_tax_exemptions(rows, policy)
    breakdown = calculate_tax_by_line(rows, policy)
    return total, breakdown


def shipping_discount(shipping: Money, discount: Money) -> Money:
    if shipping.currency != discount.currency:
        raise ValueError("shipping discount currency differs")
    if shipping.minor < 0 or discount.minor < 0:
        raise ValueError("shipping amounts cannot be negative")
    return Money(max(0, shipping.minor - discount.minor), shipping.currency)


def free_shipping_eligible(subtotal: Money, threshold: Money) -> bool:
    if subtotal.currency != threshold.currency:
        return False
    return subtotal.minor >= threshold.minor


def promotion_savings(before: Iterable[OrderLine], after: Iterable[OrderLine]) -> Money:
    gross = total_lines(before)
    net = total_lines(after)
    if gross.currency != net.currency:
        raise ValueError("promotion changed line currency")
    return Money(max(0, gross.minor - net.minor), gross.currency)


def round_percentage(value: Decimal, places: int = 2) -> Decimal:
    if places < 0 or places > 6:
        raise ValueError("decimal places must be between zero and six")
    quantizer = Decimal(1).scaleb(-places)
    return value.quantize(quantizer, rounding=ROUND_HALF_UP)


def quote_breakdown(quote: PriceQuote) -> dict[str, int | str]:
    validate_quote(quote)
    return {"currency": quote.currency, "subtotal": quote.subtotal.minor,
            "shipping": quote.shipping.minor, "tax": quote.tax.minor,
            "promotion_savings": quote.promotion_savings.minor, "total": quote.total.minor}


def line_fingerprint(line: OrderLine) -> tuple[str, int, int, int]:
    return str(line.sku), line.quantity, line.unit_price.minor, line.discount.minor if line.discount else 0


def combine_duplicate_lines(lines: Iterable[OrderLine]) -> list[OrderLine]:
    combined: dict[tuple[Sku, str, int], OrderLine] = {}
    for line in lines:
        if line.discount and line.discount.minor:
            key = (line.sku, line.description, id(line))
        else:
            key = (line.sku, line.description, line.unit_price.minor)
        current = combined.get(key)
        combined[key] = replace(line, quantity=current.quantity + line.quantity) if current else line
    return list(combined.values())


def cap_line_discount(line: OrderLine, requested: Money) -> OrderLine:
    if line.unit_price.currency != requested.currency:
        raise ValueError("discount currency differs from line")
    gross = line.unit_price * line.quantity
    return replace(line, discount=Money(min(max(0, requested.minor), gross.minor), gross.currency))


def promotion_candidate_order(promotions: Iterable[Promotion], subtotal: Money,
                              context: PricingContext) -> list[Promotion]:
    candidates = [promotion for promotion in promotions if promotion.eligible(subtotal, context)]
    candidates.sort(key=lambda promotion: (not promotion.combinable,
                                          promotion.minimum_subtotal.minor if promotion.minimum_subtotal else 0,
                                          promotion.normalized_code()))
    return candidates


def best_single_promotion(lines: list[OrderLine], promotions: Iterable[Promotion],
                          context: PricingContext) -> tuple[list[OrderLine], Promotion | None]:
    base = total_lines(lines)
    best_lines = list(lines)
    best_promotion = None
    for promotion in promotion_candidate_order(promotions, base, context):
        discounted = promotion.discount(lines, context)
        if total_lines(discounted).minor < total_lines(best_lines).minor:
            best_lines, best_promotion = discounted, promotion
    return best_lines, best_promotion


def merge_tax_policies(primary: dict[str, TaxPolicy], overrides: dict[str, TaxPolicy]) -> dict[str, TaxPolicy]:
    result = dict(primary)
    for region, policy in overrides.items():
        if region != policy.region:
            raise ValueError("policy key does not match its region")
        result[region] = policy
    return result


def tax_rate_for(region: str, policies: dict[str, TaxPolicy] | None = None) -> Decimal:
    policy = (policies or DEFAULT_TAX_POLICIES).get(region)
    if policy is None:
        raise ValueError(f"no tax policy for region {region}")
    return policy.rate


def round_cash_amount(amount: Money, currency: str, increment: int | None = None) -> Money:
    if amount.currency != currency:
        raise ValueError("cash rounding currency differs from amount")
    step = increment or (5 if currency in {"USD", "EUR"} else currency_increment(currency))
    if step is None:
        raise ValueError(f"no cash increment for {currency}")
    return round_to_increment(amount, step)


def chargeable_weight_grams(weight_grams: int, volume_cm3: int, divisor: int = 5000) -> int:
    if min(weight_grams, volume_cm3) < 0 or divisor <= 0:
        raise ValueError("weight, volume and divisor must be non-negative")
    volumetric = (volume_cm3 + divisor - 1) // divisor
    return max(weight_grams, volumetric)


def surcharge_for_remote_postcode(postcode: str, amount: Money, prefixes: tuple[str, ...]) -> Money:
    normalized = postcode.strip().upper().replace(" ", "")
    if not normalized:
        raise ValueError("postcode is required")
    return amount if any(normalized.startswith(prefix.upper()) for prefix in prefixes) else Money(0, amount.currency)


def promotion_is_expired(promotion: Promotion, at: datetime | None = None) -> bool:
    return promotion.ends_at is not None and (at or datetime.now(timezone.utc)) >= promotion.ends_at


def discount_allocation(lines: list[OrderLine], amount: Money) -> dict[str, int]:
    if lines and lines[0].unit_price.currency != amount.currency:
        raise ValueError("discount currency differs from line currency")
    bases = [replace(line, discount=None) for line in lines]
    discounted = allocate_discount(bases, amount.minor, amount.currency)
    return {line_fingerprint(line)[0] + f"#{index}": (line.discount.minor if line.discount else 0)
            for index, line in enumerate(discounted)}


def service_fee(subtotal: Money, basis_points: int, maximum: Money | None = None) -> Money:
    if basis_points < 0:
        raise ValueError("basis points cannot be negative")
    fee = round_minor(Decimal(subtotal.minor) * basis_points / 10000)
    if maximum:
        if maximum.currency != subtotal.currency:
            raise ValueError("fee cap currency differs from subtotal")
        fee = min(fee, maximum.minor)
    return Money(fee, subtotal.currency)


def order_taxable_total(order: Order, policy: TaxPolicy) -> Money:
    return policy.calculate(taxable_subtotal(order.lines), order.shipping_fee)


def line_is_tax_exempt(line: OrderLine, exempt_skus: set[Sku] | None = None) -> bool:
    return line.sku in (exempt_skus or set())


def apply_tax_exemptions(lines: Iterable[OrderLine], policy: TaxPolicy,
                         exempt_skus: set[Sku] | None = None) -> Money:
    base = taxable_subtotal(lines, exempt_skus)
    return policy.calculate(base)


def savings_rate(before: Money, after: Money) -> Decimal:
    if before.currency != after.currency:
        raise ValueError("values must use the same currency")
    if before.minor <= 0:
        return Decimal(0)
    return round_percentage(Decimal(max(0, before.minor - after.minor) * 100 / before.minor), 2)


def assert_same_currency(items: Iterable[Money], currency: str) -> None:
    for item in items:
        if item.currency != currency:
            raise ValueError(f"expected {currency}, got {item.currency}")


def discount_basis(lines: Iterable[OrderLine], sku: Sku | None = None) -> Money:
    rows = [line for line in lines if sku is None or line.sku == sku]
    return total_lines(rows)


def rule_effective_date(rule: SkuPriceRule, at: datetime | None = None) -> bool:
    return _in_period(at or datetime.now(timezone.utc), rule.starts_at, rule.ends_at)


def per_unit_discount(line: OrderLine) -> Money:
    if line.discount is None:
        return Money(0, line.unit_price.currency)
    return Money(round_minor(Decimal(line.discount.minor) / line.quantity), line.unit_price.currency)


def discount_over_limit(lines: Iterable[OrderLine], limit: Money) -> bool:
    rows = list(lines)
    currency = rows[0].unit_price.currency if rows else limit.currency
    if currency != limit.currency:
        raise ValueError("discount limit currency differs from cart")
    return sum(line.discount.minor for line in rows if line.discount) > limit.minor


def tax_included_amount(total: Money, policy: TaxPolicy) -> Money:
    if not policy.tax_inclusive:
        return Money(0, total.currency)
    return percentage_of_tax_inclusive(total, policy.rate)


def exempt_order_amount(lines: Iterable[OrderLine], exempt_skus: set[Sku]) -> Money:
    rows = list(lines)
    currency = rows[0].unit_price.currency if rows else "USD"
    return Money(sum(line.subtotal.minor for line in rows if line.sku in exempt_skus), currency)


def choose_shipping_rate(subtotal: Money, standard: Money, express: Money,
                         free_threshold: Money | None = None, express_selected: bool = False) -> Money:
    candidates = [standard, express]
    assert_same_currency(candidates, subtotal.currency)
    if express_selected:
        return express
    if free_threshold and free_shipping_eligible(subtotal, free_threshold):
        return Money(0, subtotal.currency)
    return standard


def validate_rule_set(rules: Iterable[PriceRule]) -> list[str]:
    problems = []
    for index, rule in enumerate(rules):
        if not callable(getattr(rule, "apply", None)):
            problems.append(f"rule {index} has no apply method")
        if isinstance(rule, SkuPriceRule) and rule.price.minor < 0:
            problems.append(f"rule {index} has a negative price")
    return problems
