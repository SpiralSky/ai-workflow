from fulfil.api import OrderEventData
from fulfil.models.order import Order


def order_event_data(order: Order) -> OrderEventData:
    return OrderEventData(order.order_id, order.customer_id, order.total)
