from dataclasses import dataclass
from string import Template
from fulfil.models.customer import Customer
from fulfil.models.fulfillment import Refund, Shipment
from fulfil.models.order import Order
from fulfil.util.money import format_money


@dataclass(frozen=True)
class OutgoingMessage:
    recipient: str
    subject: str
    body: str


class NotificationService:
    TEMPLATES = {
        "order": Template("Hello $customer, we received order $order. Your total is $total."),
        "shipment": Template("Hello $customer, order $order shipped via $carrier. Track it with $tracking."),
        "refund": Template("Hello $customer, refund $refund for order $order is $status. $amount was returned."),
    }

    def __init__(self, sender: str = "orders@example.test", shop_name: str = "Northstar Shop"):
        self.sender = sender
        self.shop_name = shop_name
        self.sent: list[OutgoingMessage] = []

    def order_confirmation(self, customer: Customer, order: Order) -> OutgoingMessage:
        message = OutgoingMessage(customer.email, f"Order {order.order_id} confirmed",
                                  f"Hello {customer.name}, your total is {format_money(order.total)}.")
        self.sent.append(message)
        return message

    def send(self, message: OutgoingMessage) -> OutgoingMessage:
        if "@" not in message.recipient:
            raise ValueError("message recipient is not deliverable")
        if len(message.body) > 10000:
            raise ValueError("message body is too large")
        self.sent.append(message)
        return message

    def delivery_summary(self) -> dict[str, int]:
        by_domain: dict[str, int] = {}
        for message in self.sent:
            domain = message.recipient.rsplit("@", 1)[-1].casefold()
            by_domain[domain] = by_domain.get(domain, 0) + 1
        return by_domain

    def order_update(self, customer: Customer, order: Order, message: str) -> OutgoingMessage:
        clean = " ".join(message.split())
        if not clean:
            raise ValueError("update message cannot be empty")
        notice = OutgoingMessage(customer.email, f"Update for order {order.order_id}",
                                 f"{clean} Current order total: {format_money(order.total)}.")
        return self.send(notice)

    def digest(self, messages: list[OutgoingMessage] | None = None) -> str:
        selected = messages if messages is not None else self.sent
        if not selected:
            return "No messages sent"
        total = len(selected)
        return f"{total} message(s) sent; most recent: {selected[-1].subject} to {selected[-1].recipient}"

    def render_template(self, name: str, values: dict[str, str]) -> str:
        try:
            template = self.TEMPLATES[name]
        except KeyError:
            raise ValueError(f"unknown notification template {name}") from None
        required = {key for _, key, _, _ in Template.pattern.findall(template.template) if key}
        missing = required - values.keys()
        if missing:
            raise ValueError(f"template values missing: {', '.join(sorted(missing))}")
        return template.safe_substitute(values)

    def render_order_email(self, customer: Customer, order: Order) -> str:
        return self.render_template("order", {"customer": customer.name, "order": order.order_id,
                                               "total": format_money(order.total)})

    def render_shipment_email(self, customer: Customer, order: Order, shipment: Shipment) -> str:
        return self.render_template("shipment", {"customer": customer.name, "order": order.order_id,
                                                  "carrier": shipment.carrier,
                                                  "tracking": shipment.tracking_number})

    def render_refund_email(self, customer: Customer, order: Order, refund: Refund) -> str:
        state = "processed" if refund.processed else "pending"
        return self.render_template("refund", {"customer": customer.name, "order": order.order_id,
                                                "refund": refund.refund_id, "status": state,
                                                "amount": format_money(refund.amount)})

    def order_email(self, customer: Customer, order: Order) -> OutgoingMessage:
        return self.send(OutgoingMessage(customer.email, f"{self.shop_name}: order {order.order_id}",
                                         self.render_order_email(customer, order)))

    def shipment_email(self, customer: Customer, order: Order, shipment: Shipment) -> OutgoingMessage:
        return self.send(OutgoingMessage(customer.email, f"{self.shop_name}: shipment update",
                                         self.render_shipment_email(customer, order, shipment)))

    def refund_email(self, customer: Customer, order: Order, refund: Refund) -> OutgoingMessage:
        return self.send(OutgoingMessage(customer.email, f"{self.shop_name}: refund update",
                                         self.render_refund_email(customer, order, refund)))
