from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from fulfil.events.types import OrderPlaced, RefundProcessed
from fulfil.models.money import Money
from fulfil.models.order import OrderLine
from fulfil.models.product import Sku
from fulfil.pricing import PriceQuote, compare_quotes, savings_rate, split_minor
from fulfil.storage.repositories import RepositorySet
from fulfil.util.dates import month_bounds, within_window, week_bounds
from fulfil.util.money import format_money


@dataclass(frozen=True)
class RevenueRow:
    currency: str
    gross: Money
    refunds: Money
    net: Money
    order_count: int


class RevenueReport:
    def __init__(self, repositories: RepositorySet):
        self.repositories = repositories

    def monthly(self, year: int, month: int, events: list[object] | None = None) -> list[RevenueRow]:
        start, end = month_bounds(year, month)
        orders = self.repositories.orders.all()
        refunds = self.repositories.refunds.all()
        gross: dict[str, int] = defaultdict(int)
        refunded: dict[str, int] = defaultdict(int)
        order_ids: dict[str, set[str]] = defaultdict(set)
        for order in orders:
            if within_window(order.created_at, start, end) and order.status.value != "cancelled":
                gross[order.currency] += order.total.minor
                order_ids[order.currency].add(order.order_id)
        for refund in refunds:
            if within_window(refund.created_at, start, end) and refund.processed:
                postings = [entry for entry in self.repositories.refund_postings
                            if entry.refund_id == refund.refund_id]
                refunded[refund.amount.currency] += (sum(entry.amount.minor for entry in postings)
                                                     if postings else refund.amount.minor)
        if events:
            # Event history is informational; persisted refunds remain the accounting source.
            seen = {refund.refund_id for refund in refunds}
            for event in events:
                if isinstance(event, RefundProcessed) and event.refund_id not in seen and within_window(event.occurred_at, start, end):
                    refunded[event.amount.currency] += event.amount.minor
        currencies = sorted(set(gross) | set(refunded))
        return [RevenueRow(currency, Money(gross[currency], currency), Money(refunded[currency], currency),
                           Money(gross[currency] - refunded[currency], currency), len(order_ids[currency]))
                for currency in currencies]

    def text(self, year: int, month: int) -> str:
        rows = self.monthly(year, month)
        if not rows:
            return f"Revenue {year:04d}-{month:02d}: no activity"
        detail = "\n".join(f"{row.currency} gross {format_money(row.gross)} refunds {format_money(row.refunds)} "
                            f"net {format_money(row.net)} ({row.order_count} orders)" for row in rows)
        return f"Revenue {year:04d}-{month:02d}\n{detail}"

    def product_units(self, year: int, month: int) -> dict[Sku, int]:
        start, end = month_bounds(year, month)
        units: dict[Sku, int] = defaultdict(int)
        for order in self.repositories.orders.all():
            if within_window(order.created_at, start, end) and order.status.value != "cancelled":
                for line in order.lines:
                    units[line.sku] += line.quantity
        return dict(units)

    def gross_by_day(self, year: int, month: int) -> dict[str, dict[str, Money]]:
        start, end = month_bounds(year, month)
        totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for order in self.repositories.orders.all():
            if within_window(order.created_at, start, end) and order.status.value != "cancelled":
                totals[order.created_at.date().isoformat()][order.currency] += order.total.minor
        return {day: {currency: Money(value, currency) for currency, value in amounts.items()}
                for day, amounts in totals.items()}

    def order_count(self, year: int, month: int, currency: str | None = None) -> int:
        start, end = month_bounds(year, month)
        return sum(1 for order in self.repositories.orders.all()
                   if within_window(order.created_at, start, end)
                   and order.status.value != "cancelled"
                   and (currency is None or order.currency == currency))

    def allocate_net(self, row: RevenueRow, weights: list[int]) -> list[Money]:
        return split_minor(row.net, weights)

    def refund_rate(self, row: RevenueRow) -> str:
        return f"{savings_rate(row.gross, row.net)}%"

    def compare_rows(self, first: RevenueRow, second: RevenueRow) -> int:
        if first.currency != second.currency:
            raise ValueError("revenue rows must use the same currency")
        before = PriceQuote([OrderLine(Sku("REPORT-NET"), "Net revenue", 1, first.net)],
                            Money(0, first.currency), Money(0, first.currency), first.currency)
        after = PriceQuote([OrderLine(Sku("REPORT-NET"), "Net revenue", 1, second.net)],
                           Money(0, second.currency), Money(0, second.currency), second.currency)
        return compare_quotes(before, after)

    def grouped(self, start: datetime, end: datetime, period: str = "month") -> dict[str, list[RevenueRow]]:
        if start.tzinfo is None or end.tzinfo is None or start >= end:
            raise ValueError("report window must be an increasing timezone-aware range")
        if period not in {"day", "week", "month", "quarter"}:
            raise ValueError("period must be day, week, month or quarter")
        totals: dict[tuple[str, str], int] = defaultdict(int)
        counts: dict[tuple[str, str], set[str]] = defaultdict(set)
        for order in self.repositories.orders.all():
            if not within_window(order.created_at, start, end) or order.status.value == "cancelled":
                continue
            stamp = order.created_at
            if period == "day":
                label = stamp.date().isoformat()
            elif period == "week":
                label = week_bounds(stamp.date())[0].isoformat()
            elif period == "quarter":
                label = f"{stamp.year}-Q{(stamp.month - 1) // 3 + 1}"
            else:
                label = f"{stamp.year}-{stamp.month:02d}"
            key = label, order.currency
            totals[key] += order.total.minor
            counts[key].add(order.order_id)
        output = defaultdict(list)
        for (label, currency), amount in sorted(totals.items()):
            gross = Money(amount, currency)
            output[label].append(RevenueRow(currency, gross, Money(0, currency), gross, len(counts[(label, currency)])))
        return dict(output)

    def channel_totals(self, year: int, month: int) -> dict[str, dict[str, Money]]:
        start, end = month_bounds(year, month)
        totals: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for order in self.repositories.orders.all():
            if not within_window(order.created_at, start, end) or order.status.value == "cancelled":
                continue
            channel = order.metadata.get("channel", "unknown")
            totals[channel][order.currency] += order.total.minor
        return {channel: {currency: Money(value, currency) for currency, value in amounts.items()}
                for channel, amounts in totals.items()}

    def year_to_date(self, year: int, currency: str | None = None) -> list[RevenueRow]:
        start = datetime(year, 1, 1, tzinfo=timezone.utc)
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
        rows = self.grouped(start, end, "month")
        merged: dict[str, int] = defaultdict(int)
        count_by_currency: dict[str, int] = defaultdict(int)
        for period_rows in rows.values():
            for row in period_rows:
                if currency is None or row.currency == currency:
                    merged[row.currency] += row.gross.minor
                    count_by_currency[row.currency] += row.order_count
        return [RevenueRow(code, Money(amount, code), Money(0, code), Money(amount, code), count_by_currency[code])
                for code, amount in sorted(merged.items())]
