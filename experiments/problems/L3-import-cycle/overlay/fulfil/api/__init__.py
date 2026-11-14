from fulfil.services.orders import OrderService
from fulfil.api.handlers import Application, create_application, get_product, place_order

__all__ = ["Application", "create_application", "get_product", "place_order"]


def is_success(response) -> bool:
    return 200 <= response.status < 300


from dataclasses import dataclass
from fulfil.models.money import Money


@dataclass(frozen=True)
class OrderEventData:
    order_id: str
    customer_id: str
    total: Money


__all__ += ["OrderEventData", "OrderService"]
