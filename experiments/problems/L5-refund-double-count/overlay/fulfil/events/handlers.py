from weakref import WeakKeyDictionary
from functools import partial
from fulfil.events.bus import EventBus
from fulfil.events.types import (
    CustomerAddressChanged, OrderCancelled, OrderPlaced, RefundProcessed,
    ShipmentLabelCreated, StockChanged,
)
from fulfil.storage.repositories import RepositorySet
from fulfil.cache.readthrough import ReadThroughCache


_reporting_buses = WeakKeyDictionary()
_reporting_enabled = False


def _subscribe_refunds(bus: EventBus, repositories: RepositorySet, key: str) -> None:
    posted = repositories.refund_posting_keys.setdefault(key, set())
    bus.subscribe_once(RefundProcessed, key, partial(_record_refund, repositories, posted))


def _register_reporting(bus: EventBus, repositories: RepositorySet) -> None:
    _subscribe_refunds(bus, repositories, f"report-refund:{id(repositories)}")


def enable_reporting() -> None:
    global _reporting_enabled
    _reporting_enabled = True
    for bus, repositories in list(_reporting_buses.items()):
        _register_reporting(bus, repositories)


def register_handlers(bus: EventBus, repositories: RepositorySet,
                      product_cache: ReadThroughCache | None = None) -> EventBus:
    """Connect domain events to storage updates; safe when called repeatedly."""
    _reporting_buses[bus] = repositories
    repository_key = str(id(repositories))
    bus.subscribe_once(StockChanged, f"stock:{repository_key}", partial(_record_stock, repositories))
    _subscribe_refunds(bus, repositories, f"refund:{repository_key}")
    bus.subscribe_once(OrderPlaced, f"placed:{repository_key}", partial(_record_order, repositories))
    bus.subscribe_once(OrderCancelled, f"cancelled:{repository_key}", partial(_record_cancellation, repositories))
    bus.subscribe_once(ShipmentLabelCreated, f"shipment:{repository_key}",
                       partial(_record_shipment, repositories))
    bus.subscribe_once(CustomerAddressChanged, f"address:{repository_key}",
                       partial(_record_address, repositories))
    if product_cache is not None:
        bus.subscribe_once(StockChanged, f"cache:{id(product_cache)}", partial(_invalidate_product, product_cache))
    if _reporting_enabled:
        _register_reporting(bus, repositories)
    return bus


def _invalidate_product(product_cache: ReadThroughCache, event: StockChanged) -> None:
    product_cache.invalidate(event.product_code.value)


def _record_stock(repositories: RepositorySet, event: StockChanged) -> None:
    product = repositories.products.get(event.sku)
    if product.stock_on_hand < 0:
        raise ValueError("stock event would make inventory negative")


def _record_refund(repositories: RepositorySet, posted: set[str], event: RefundProcessed) -> None:
    refund = repositories.refunds.find(event.refund_id)
    if refund is not None and not refund.processed:
        refund.mark_processed()
        repositories.refunds.save(refund)
    if refund is not None and event.refund_id not in posted:
        repositories.refund_postings.append(event)
        posted.add(event.refund_id)


def _record_order(repositories: RepositorySet, event: OrderPlaced) -> None:
    order = repositories.orders.find(event.order_id)
    if order is None:
        raise KeyError(f"placed order {event.order_id} was not saved")


def _record_cancellation(repositories: RepositorySet, event: OrderCancelled) -> None:
    order = repositories.orders.find(event.order_id)
    if order is None:
        raise KeyError(f"cancelled order {event.order_id} was not saved")


def _record_shipment(repositories: RepositorySet, event: ShipmentLabelCreated) -> None:
    shipment = repositories.shipments.find(event.shipment_id)
    if shipment is None or shipment.tracking_number != event.tracking_number:
        raise ValueError("shipment label event does not match a stored shipment")


def _record_address(repositories: RepositorySet, event: CustomerAddressChanged) -> None:
    customer = repositories.customers.get(event.customer_id)
    if event.address_index >= len(customer.addresses):
        raise IndexError("address event points outside the customer's address list")


def handler_status(bus: EventBus) -> dict[str, int]:
    return bus.subscriptions()


def unregister_application_handlers(bus: EventBus, repositories: RepositorySet,
                                   product_cache: ReadThroughCache | None = None) -> int:
    _reporting_buses.pop(bus, None)
    repository_key = str(id(repositories))
    registrations = ((StockChanged, f"stock:{repository_key}"),
                     (RefundProcessed, f"refund:{repository_key}"),
                     (OrderPlaced, f"placed:{repository_key}"),
                     (OrderCancelled, f"cancelled:{repository_key}"),
                     (ShipmentLabelCreated, f"shipment:{repository_key}"),
                     (CustomerAddressChanged, f"address:{repository_key}"))
    removed = sum(bus.unsubscribe_key(event_type, key) for event_type, key in registrations)
    if product_cache is not None:
        removed += bus.unsubscribe_key(StockChanged, f"cache:{id(product_cache)}")
    return removed
