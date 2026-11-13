from fulfil.models.order import Order
from fulfil.models.money import Money
from fulfil.models.product import Sku
from fulfil.pricing import (
    PricingEngine, discount_allocation, effective_unit_price, exempt_order_amount,
    line_discount_for_display, order_taxable_total, per_unit_discount,
    quote_breakdown, round_cash_amount, tax_summary,
    savings_rate,
)
from fulfil.util.money import format_money


def render_invoice(order: Order, shop_name: str = "Northstar Shop") -> str:
    rows = [f"Invoice {order.order_id}", shop_name, f"Status: {order.status.value}", ""]
    for line in order.lines:
        rows.append(f"{line.quantity} x {line.description} ({line.sku})  "
                    f"{format_money(line.subtotal)} — {line_discount_for_display(line)}")
    rows.extend(["", f"Subtotal: {format_money(order.item_subtotal)}"])
    if order.shipping_fee:
        rows.append(f"Shipping: {format_money(order.shipping_fee)}")
    if order.tax:
        rows.append(f"Tax ({order.metadata.get('tax_region', 'US-CA')}): {format_money(order.tax)}")
        for tax_line in invoice_tax_lines(order, order.metadata.get("tax_region", "US-CA")):
            rows.append(f"  {tax_line['sku']} tax: {tax_line['tax']}")
    rows.append(f"Savings: {invoice_discount_rate(order)}")
    total_due = round_cash_amount(order.total, order.currency)
    rows.append(f"Total: {format_money(total_due)}")
    return "\n".join(rows)


def invoice_filename(order: Order) -> str:
    safe_id = "".join(character if character.isalnum() or character == "-" else "-"
                      for character in order.order_id)
    return f"invoice-{safe_id}.txt"


def invoice_lines(order: Order) -> list[dict[str, str | int]]:
    return [{"sku": str(line.sku), "description": line.description,
             "quantity": line.quantity, "unit_price": format_money(line.unit_price),
             "discount": format_money(line.discount) if line.discount else format_money(0),
             "discount_per_unit": format_money(per_unit_discount(line)),
             "effective_unit_price": format_money(effective_unit_price(line)),
             "amount": format_money(line.subtotal)} for line in order.lines]


def payment_reference(order: Order) -> str:
    return f"{order.order_id}:{order.currency}:{order.total.minor}"


def invoice_total_label(order: Order) -> str:
    return f"Amount due: {format_money(order.total)} {order.currency}"


def pricing_summary(order: Order) -> dict[str, int | str]:
    quote = PricingEngine().quote(order, shipping=order.shipping_fee)
    return quote_breakdown(quote)


def invoice_tax_lines(order: Order, region: str = "US-CA") -> list[dict[str, str | int]]:
    quote = PricingEngine().quote(order, region=region)
    excluded = {Sku(value) for value in order.metadata.get("tax_exempt_skus", "").split(",") if value}
    taxable_lines = [line for line in quote.lines if line.sku not in excluded]
    _, by_sku = tax_summary(taxable_lines, PricingEngine().policies[region])
    return [{"sku": str(sku), "tax": format_money(amount)} for sku, amount in sorted(by_sku.items())]


def invoice_taxable_amount(order: Order, region: str = "US-CA") -> Money:
    policy = PricingEngine().policies[region]
    exempt = {Sku(value) for value in order.metadata.get("tax_exempt_skus", "").split(",") if value}
    taxable = [line for line in order.lines if line.sku not in exempt]
    result = order_taxable_total(order, policy)
    if exempt:
        result = policy.calculate(Money(sum(line.subtotal.minor for line in taxable), order.currency),
                                  order.shipping_fee)
    return result


def invoice_tax_exempt_amount(order: Order, exempt_skus: set[Sku]) -> Money:
    return exempt_order_amount(order.lines, exempt_skus)


def invoice_discount_rate(order: Order) -> str:
    before = Money(sum(line.unit_price.minor * line.quantity for line in order.lines), order.currency)
    return f"{savings_rate(before, order.item_subtotal)}%"


def credit_note(order: Order, refund: Money, reason: str) -> str:
    if refund.currency != order.currency or not 0 < refund.minor <= order.total.minor:
        raise ValueError("credit note amount is outside the order balance")
    allocations = discount_allocation(order.lines, refund)
    rows = [f"Credit note for {order.order_id}", f"Reason: {' '.join(reason.split())}"]
    rows.extend(f"{key}: {format_money(Money(amount, order.currency))}" for key, amount in allocations.items())
    rows.append(f"Credit total: {format_money(refund)}")
    return "\n".join(rows)
