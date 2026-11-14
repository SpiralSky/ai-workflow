from dataclasses import dataclass
from datetime import datetime
from fulfil.models.money import Money
from fulfil.pricing import discount_allocation
from fulfil.storage.repositories import RepositorySet
from fulfil.util.dates import month_bounds, within_window
from fulfil.util.money import format_money


@dataclass(frozen=True)
class RefundRow:
    refund_id: str
    order_id: str
    amount: Money
    reason: str
    created_at: datetime


class RefundReport:
    def __init__(self, repositories: RepositorySet):
        self.repositories = repositories

    def rows(self, order_id: str | None = None) -> list[RefundRow]:
        refunds = self.repositories.refunds.all()
        if order_id:
            refunds = [refund for refund in refunds if refund.order_id == order_id]
        refunds.sort(key=lambda refund: (refund.created_at, refund.refund_id))
        return [RefundRow(refund.refund_id, refund.order_id, refund.amount, refund.reason, refund.created_at)
                for refund in refunds]

    def totals(self) -> dict[str, Money]:
        totals: dict[str, Money] = {}
        for refund in self.repositories.refunds.all():
            if refund.processed:
                currency = refund.amount.currency
                totals[currency] = totals.get(currency, Money(0, currency)) + refund.amount
        return totals

    def by_reason(self) -> dict[str, Money]:
        totals: dict[str, Money] = {}
        for refund in self.repositories.refunds.all():
            if not refund.processed:
                continue
            key = refund.reason.strip().casefold() or "unspecified"
            current = totals.get(key, Money(0, refund.amount.currency))
            if current.currency != refund.amount.currency:
                key = f"{key} ({refund.amount.currency})"
                current = totals.get(key, Money(0, refund.amount.currency))
            totals[key] = current + refund.amount
        return totals

    def text(self, order_id: str | None = None) -> str:
        rows = self.rows(order_id)
        if not rows:
            return "No refunds"
        return "\n".join(f"{row.refund_id} {row.order_id} {format_money(row.amount)} — {row.reason}"
                         for row in rows)

    def line_breakdown(self, refund_id: str) -> dict[str, int]:
        refund = self.repositories.refunds.get(refund_id)
        if refund.line_allocations:
            return dict(refund.line_allocations)
        order = self.repositories.orders.get(refund.order_id)
        return discount_allocation(order.lines, refund.amount)

    def monthly_totals(self, year: int, month: int) -> dict[str, Money]:
        start, end = month_bounds(year, month)
        totals: dict[str, Money] = {}
        for refund in self.repositories.refunds.all():
            if refund.processed and within_window(refund.created_at, start, end):
                currency = refund.amount.currency
                totals[currency] = totals.get(currency, Money(0, currency)) + refund.amount
        return totals

    def grouped_by_period(self, start: datetime, end: datetime) -> dict[str, dict[str, Money]]:
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("report range must be timezone aware and increasing")
        grouped: dict[str, dict[str, Money]] = {}
        for refund in self.repositories.refunds.all():
            if not refund.processed or not within_window(refund.created_at, start, end):
                continue
            label = refund.created_at.strftime("%Y-%m")
            currency = refund.amount.currency
            bucket = grouped.setdefault(label, {})
            bucket[currency] = bucket.get(currency, Money(0, currency)) + refund.amount
        return grouped

    def text_by_currency(self) -> str:
        totals = self.totals()
        if not totals:
            return "No processed refunds"
        return "\n".join(f"{currency}: {format_money(amount)}" for currency, amount in sorted(totals.items()))
