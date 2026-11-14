from fulfil.models.customer import Address, Customer
from fulfil.models.fulfillment import BackorderRequest, Refund, Shipment
from fulfil.models.money import Money
from fulfil.models.order import Order, OrderLine, OrderStatus
from fulfil.models.product import Product, Sku

__all__ = ["Address", "BackorderRequest", "Customer", "Money", "Order", "OrderLine", "OrderStatus", "Product", "Refund", "Shipment", "Sku"]


def supported_currencies() -> tuple[str, ...]:
    return ("EUR", "GBP", "USD")
