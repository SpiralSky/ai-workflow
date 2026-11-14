import unittest
from fulfil.api import OrderEventData
from fulfil.events.handlers import order_placed_event
from fulfil.models.money import Money
from fulfil.models.order import Order, OrderLine
from fulfil.models.product import Sku
from fulfil.reports import order_event_data


class OrderEventDataTests(unittest.TestCase):
    def test_report_data_and_placed_event_keep_order_values(self):
        for currency in ("USD", "EUR", "GBP"):
            order = Order("ord-42", "cus-8", currency,
                          [OrderLine(Sku("item-1"), "Item", 3, Money(125, currency))])
            data = order_event_data(order)
            self.assertIsInstance(data, OrderEventData)
            self.assertEqual((data.order_id, data.customer_id, data.total),
                             (order.order_id, order.customer_id, Money(375, currency)))
            event = order_placed_event(order)
            self.assertEqual((event.order_id, event.customer_id, event.total),
                             (data.order_id, data.customer_id, data.total))
            self.assertIsNotNone(event.occurred_at)
