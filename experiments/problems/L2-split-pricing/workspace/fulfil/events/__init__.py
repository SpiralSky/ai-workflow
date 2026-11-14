from fulfil.events.bus import EventBus
from fulfil.events.types import CustomerAddressChanged, OrderCancelled, OrderPlaced, RefundProcessed, ShipmentLabelCreated, StockChanged

__all__ = ["CustomerAddressChanged", "EventBus", "OrderCancelled", "OrderPlaced", "RefundProcessed", "ShipmentLabelCreated", "StockChanged"]


def domain_event_types() -> tuple[type, ...]:
    return (CustomerAddressChanged, OrderCancelled, OrderPlaced, RefundProcessed, ShipmentLabelCreated, StockChanged)
