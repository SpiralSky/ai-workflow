from dataclasses import dataclass
from fulfil.cache.readthrough import ReadThroughCache
from fulfil.config import Settings
from fulfil.events.bus import EventBus
from fulfil.events.handlers import register_handlers
from fulfil.events.types import CustomerAddressChanged
from fulfil.models.customer import Address
from fulfil.models.product import Sku
from fulfil.models.money import Money
from fulfil.services.inventory import InventoryService
from fulfil.services.orders import OrderService
from fulfil.storage.repositories import RepositorySet
from fulfil.api.schemas import ApiResponse, OrderRequest, OrderSummary, PageRequest, ProductLookup, error_response, page_response
from fulfil.services.invoicing import render_invoice
from fulfil.services.notifications import NotificationService
from fulfil.services.refunds import RefundService
from fulfil.services.shipping import ShippingService
from fulfil.util.money import format_money


@dataclass
class Application:
    settings: Settings
    repositories: RepositorySet
    bus: EventBus
    inventory: InventoryService
    orders: OrderService
    product_cache: ReadThroughCache
    shipping: ShippingService
    refunds: RefundService
    notifications: NotificationService


def create_application(settings: Settings | None = None, repositories: RepositorySet | None = None) -> Application:
    config = settings or Settings()
    store = repositories or RepositorySet()
    bus = EventBus()
    product_cache = ReadThroughCache()
    register_handlers(bus, store, product_cache)
    inventory = InventoryService(store, bus)
    orders = OrderService(store, inventory, bus)
    shipping = ShippingService(store, bus)
    refunds = RefundService(store, bus, inventory)
    notifications = NotificationService(config.notification_sender, config.shop_name)
    return Application(config, store, bus, inventory, orders, product_cache,
                       shipping, refunds, notifications)


def get_product(app: Application, sku: str) -> ApiResponse:
    try:
        key = str(ProductLookup.parse(sku).sku)
    except ValueError as exc:
        return ApiResponse(400, {"error": "invalid_sku", "detail": str(exc)})
    product = app.product_cache.get(key, app.repositories.products.find)
    if product is None or not product.active:
        return ApiResponse(404, {"error": "product_not_found"})
    return ApiResponse(200, {"sku": str(product.sku), "name": product.name,
                             "price": format_money(product.unit_price), "currency": product.unit_price.currency,
                             "available": product.stock_on_hand})


def place_order(app: Application, request: OrderRequest) -> ApiResponse:
    try:
        request.validate()
        lines = [(Sku(row["sku"]), int(row["quantity"])) for row in request.lines]
        order = app.orders.place(request.customer_id, lines, request.currency,
                                 request.shipping_address, request.promotion_code,
                                 request.allow_backorder, request.coupon_codes)
    except (KeyError, ValueError) as exc:
        return ApiResponse(400, {"error": "invalid_order", "detail": str(exc)})
    summary = OrderSummary(order.order_id, order.status.value, format_money(order.total))
    customer = app.repositories.customers.get(order.customer_id)
    app.notifications.order_email(customer, order)
    return ApiResponse(201, summary.as_dict())


def cancel_order(app: Application, order_id: str, reason: str = "customer request") -> ApiResponse:
    try:
        order = app.orders.cancel(order_id, reason)
    except KeyError:
        return ApiResponse(404, {"error": "order_not_found"})
    except ValueError as exc:
        return ApiResponse(409, {"error": "cannot_cancel", "detail": str(exc)})
    return ApiResponse(200, {"order_id": order.order_id, "status": order.status.value})


def search_products(app: Application, query: str, limit: int = 30) -> ApiResponse:
    if limit <= 0 or limit > 100:
        return error_response("invalid_limit")
    products = app.repositories.products.search(query)[:limit]
    items = [{"sku": str(product.sku), "name": product.name,
              "price": format_money(product.unit_price), "currency": product.unit_price.currency,
              "available": product.stock_on_hand} for product in products]
    return ApiResponse(200, {"items": items, "count": len(items)})


def get_order(app: Application, order_id: str) -> ApiResponse:
    order = app.repositories.orders.find(order_id)
    if order is None:
        return ApiResponse(404, {"error": "order_not_found"})
    return ApiResponse(200, {"order_id": order.order_id, "customer_id": order.customer_id,
                             "status": order.status.value, "currency": order.currency,
                             "subtotal": format_money(order.item_subtotal),
                             "shipping": format_money(order.shipping_fee or 0),
                             "tax": format_money(order.tax or 0), "total": format_money(order.total),
                             "revision": order.revision,
                             "lines": [{"sku": str(line.sku), "description": line.description,
                                        "quantity": line.quantity, "line_total": format_money(line.subtotal)}
                                       for line in order.lines],
                             "backorders": [{"sku": str(line.sku), "quantity": line.quantity}
                                            for line in order.backorder_lines]})


def customer_orders(app: Application, customer_id: str, offset: int = 0, limit: int = 20) -> ApiResponse:
    try:
        page = PageRequest(offset, limit)
    except ValueError:
        return ApiResponse(400, {"error": "invalid_page"})
    if app.repositories.customers.find(customer_id) is None:
        return ApiResponse(404, {"error": "customer_not_found"})
    orders = app.repositories.orders.for_customer(customer_id)
    orders.sort(key=lambda order: order.created_at, reverse=True)
    window = page.slice(orders)
    summaries = [OrderSummary(order.order_id, order.status.value, format_money(order.total)).as_dict()
                 for order in window]
    return ApiResponse(200, {**page_response(orders, page), "items": summaries,
                             "total": len(orders)})


def restock_product(app: Application, sku: str, quantity: int) -> ApiResponse:
    try:
        product = app.inventory.restock(ProductLookup.parse(sku).sku, quantity, "api")
    except (KeyError, ValueError) as exc:
        return ApiResponse(400, {"error": "restock_failed", "detail": str(exc)})
    app.product_cache.invalidate(str(Sku(sku)))
    return ApiResponse(200, {"sku": str(product.sku), "available": product.stock_on_hand})


def health(app: Application) -> ApiResponse:
    return ApiResponse(200, {"status": "ok", "products": app.repositories.products.count(),
                             "orders": app.repositories.orders.count(),
                             "event_count": len(app.bus.history())})


def amend_order(app: Application, order_id: str, request: OrderRequest) -> ApiResponse:
    try:
        request.validate()
        if request.customer_id != app.repositories.orders.get(order_id).customer_id:
            raise ValueError("customer cannot amend another customer's order")
        rows = [(Sku(row["sku"]), int(row["quantity"])) for row in request.lines]
        order = app.orders.amend(order_id, rows, request.allow_backorder)
    except KeyError:
        return ApiResponse(404, {"error": "order_not_found"})
    except (ValueError, TypeError) as exc:
        return error_response("invalid_amendment", str(exc))
    return ApiResponse(200, OrderSummary(order.order_id, order.status.value, format_money(order.total)).as_dict())


def cancel_order_line(app: Application, order_id: str, sku: str, quantity: int) -> ApiResponse:
    try:
        order = app.orders.cancel_quantity(order_id, ProductLookup.parse(sku).sku, quantity)
    except KeyError:
        return ApiResponse(404, {"error": "order_not_found"})
    except (ValueError, TypeError) as exc:
        return ApiResponse(409, {"error": "line_cancellation_failed", "detail": str(exc)})
    return ApiResponse(200, {"order_id": order.order_id, "total": format_money(order.total),
                             "revision": order.revision})


def refund_order(app: Application, order_id: str, amount: Money | None = None,
                 reason: str = "returned goods", restock: dict[str, int] | None = None) -> ApiResponse:
    try:
        sku_quantities = {Sku(code): quantity for code, quantity in (restock or {}).items()}
        refund = app.refunds.issue(order_id, amount, reason, sku_quantities)
        order = app.repositories.orders.get(order_id)
        customer = app.repositories.customers.get(order.customer_id)
        app.notifications.refund_email(customer, order, refund)
    except KeyError:
        return ApiResponse(404, {"error": "order_not_found"})
    except (ValueError, TypeError) as exc:
        return error_response("refund_failed", str(exc))
    return ApiResponse(201, {"refund_id": refund.refund_id, "amount": format_money(refund.amount),
                             "processed": refund.processed, "restocked": refund.restocked})


def invoice_order(app: Application, order_id: str) -> ApiResponse:
    order = app.repositories.orders.find(order_id)
    if order is None:
        return ApiResponse(404, {"error": "order_not_found"})
    return ApiResponse(200, {"invoice": render_invoice(order), "currency": order.currency})


def update_customer_address(app: Application, customer_id: str, address: Address,
                            make_primary: bool = False) -> ApiResponse:
    customer = app.repositories.customers.find(customer_id)
    if customer is None:
        return ApiResponse(404, {"error": "customer_not_found"})
    if not isinstance(address, Address):
        return error_response("invalid_address")
    customer.add_address(address, make_primary)
    index = customer.addresses.index(address)
    app.repositories.customers.save(customer)
    app.bus.publish(CustomerAddressChanged(customer_id, index))
    return ApiResponse(200, {"customer_id": customer_id, "address_index": index,
                             "primary": index == 0})


def shipping_options(app: Application, order_id: str, postcode: str) -> ApiResponse:
    order = app.repositories.orders.find(order_id)
    if order is None:
        return ApiResponse(404, {"error": "order_not_found"})
    try:
        rates = app.shipping.quote_for_postcode(order, postcode)
    except ValueError as exc:
        return error_response("shipping_unavailable", str(exc))
    return ApiResponse(200, {"rates": [{"carrier": rate.carrier, "service": rate.service,
                                        "amount": format_money(rate.amount),
                                        "currency": rate.amount.currency, "zone": rate.zone,
                                        "billable_grams": rate.billable_grams,
                                        "estimated_days": rate.estimated_days} for rate in rates]})


def create_shipment(app: Application, order_id: str, rate_index: int = 0) -> ApiResponse:
    order = app.repositories.orders.find(order_id)
    if order is None:
        return ApiResponse(404, {"error": "order_not_found"})
    if not isinstance(order.shipping_address, Address):
        return error_response("missing_shipping_address")
    try:
        rates = app.shipping.rates(order, order.shipping_address)
        if not 0 <= rate_index < len(rates):
            raise ValueError("rate selection is outside the available options")
        shipment = app.shipping.create_label(order, rates[rate_index])
    except (KeyError, ValueError) as exc:
        return error_response("label_failed", str(exc))
    customer = app.repositories.customers.get(order.customer_id)
    app.notifications.shipment_email(customer, order, shipment)
    return ApiResponse(201, {"shipment_id": shipment.shipment_id,
                             "tracking_number": shipment.tracking_number,
                             "carrier": shipment.carrier})


def dispatch_shipment(app: Application, shipment_id: str, carrier_scan: str = "") -> ApiResponse:
    try:
        shipment = app.shipping.dispatch(shipment_id, carrier_scan)
    except KeyError:
        return ApiResponse(404, {"error": "shipment_not_found"})
    except ValueError as exc:
        return ApiResponse(409, {"error": "shipment_transition_failed", "detail": str(exc)})
    return ApiResponse(200, {"shipment_id": shipment.shipment_id, "state": shipment.state.value})


def deliver_shipment(app: Application, shipment_id: str) -> ApiResponse:
    try:
        shipment = app.shipping.confirm_delivery(shipment_id)
    except KeyError:
        return ApiResponse(404, {"error": "shipment_not_found"})
    except ValueError as exc:
        return ApiResponse(409, {"error": "shipment_transition_failed", "detail": str(exc)})
    return ApiResponse(200, {"shipment_id": shipment.shipment_id, "state": shipment.state.value})
