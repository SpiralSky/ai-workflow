from fulfil.cli.commands import AdminCommands

__all__ = ["AdminCommands"]


def command_names() -> tuple[str, ...]:
    return ("restock", "stock_report", "revenue_report", "refund_report", "replay")
