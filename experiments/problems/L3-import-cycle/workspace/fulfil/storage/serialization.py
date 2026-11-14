import json
from datetime import datetime
from decimal import Decimal
from fulfil.models import Address, Customer, Money, Order, OrderLine, OrderStatus, Product, Refund, Shipment, Sku
from fulfil.models.fulfillment import ShipmentState

CURRENT_SCHEMA_VERSION = 2


def product_to_dict(product: Product) -> dict:
    return {"sku": str(product.sku), "name": product.name, "unit_price": product.unit_price.minor,
            "currency": product.unit_price.currency, "stock_on_hand": product.stock_on_hand,
            "active": product.active, "tags": sorted(product.tags), "updated_at": product.updated_at.isoformat(),
            "weight_grams": product.weight_grams, "volume_cm3": product.volume_cm3,
            "tax_exempt_regions": sorted(product.tax_exempt_regions),
            "break_quantities": list(product.break_quantities),
            "break_discount_rate": str(product.break_discount_rate)}


def product_from_dict(data: dict) -> Product:
    return Product(Sku(data["sku"]), data["name"], Money(data["unit_price"], data["currency"]),
                   int(data["stock_on_hand"]), bool(data.get("active", True)), set(data.get("tags", [])),
                   datetime.fromisoformat(data["updated_at"]), int(data.get("weight_grams", 250)),
                   int(data.get("volume_cm3", 400)), set(data.get("tax_exempt_regions", [])),
                   tuple(data.get("break_quantities", [])), Decimal(data.get("break_discount_rate", "0")))


def address_to_dict(address: Address) -> dict:
    return {"recipient": address.recipient, "line1": address.line1, "line2": address.line2,
            "city": address.city, "postal_code": address.postal_code, "country": address.country}


def address_from_dict(data: dict) -> Address:
    return Address(**data)


def customer_to_dict(customer: Customer) -> dict:
    return {"customer_id": customer.customer_id, "name": customer.name, "email": customer.email,
            "addresses": [address_to_dict(address) for address in customer.addresses],
            "marketing_opt_in": customer.marketing_opt_in}


def customer_from_dict(data: dict) -> Customer:
    return Customer(data["customer_id"], data["name"], data["email"],
                    [address_from_dict(item) for item in data.get("addresses", [])],
                    bool(data.get("marketing_opt_in", False)))


def line_to_dict(line: OrderLine) -> dict:
    return {"sku": str(line.sku), "description": line.description, "quantity": line.quantity,
            "unit_price": line.unit_price.minor, "currency": line.unit_price.currency,
            "discount": line.discount.minor if line.discount else None}


def line_from_dict(data: dict) -> OrderLine:
    discount = Money(data["discount"], data["currency"]) if data.get("discount") is not None else None
    return OrderLine(Sku(data["sku"]), data["description"], int(data["quantity"]),
                     Money(data["unit_price"], data["currency"]), discount)


def order_to_dict(order: Order) -> dict:
    return {"order_id": order.order_id, "customer_id": order.customer_id, "currency": order.currency,
            "lines": [line_to_dict(line) for line in order.lines], "status": order.status.value,
            "shipping_fee": order.shipping_fee.minor if order.shipping_fee else None,
            "tax": order.tax.minor if order.tax else None, "created_at": order.created_at.isoformat(),
            "revision": order.revision, "metadata": dict(order.metadata),
            "tax_inclusive": order.tax_inclusive,
            "backorder_lines": [line_to_dict(line) for line in order.backorder_lines],
            "cancellation_history": list(order.cancellation_history),
            "status_history": [[status, at.isoformat()] for status, at in order.status_history]}


def order_from_dict(data: dict) -> Order:
    order = Order(data["order_id"], data["customer_id"], data["currency"],
                  [line_from_dict(line) for line in data.get("lines", [])], OrderStatus(data["status"]),
                  created_at=datetime.fromisoformat(data["created_at"]), revision=int(data.get("revision", 0)),
                  metadata=dict(data.get("metadata", {})), tax_inclusive=bool(data.get("tax_inclusive", False)),
                  backorder_lines=[line_from_dict(line) for line in data.get("backorder_lines", [])],
                  cancellation_history=list(data.get("cancellation_history", [])),
                  status_history=[(row[0], datetime.fromisoformat(row[1]))
                                  for row in data.get("status_history", [])])
    if data.get("shipping_fee") is not None:
        order.shipping_fee = Money(data["shipping_fee"], order.currency)
    if data.get("tax") is not None:
        order.tax = Money(data["tax"], order.currency)
    return order


def refund_to_dict(refund: Refund) -> dict:
    return {"refund_id": refund.refund_id, "order_id": refund.order_id, "amount": refund.amount.minor,
            "currency": refund.amount.currency, "reason": refund.reason,
            "created_at": refund.created_at.isoformat(), "processed": refund.processed,
            "restocked": refund.restocked, "line_allocations": dict(refund.line_allocations)}


def refund_from_dict(data: dict) -> Refund:
    return Refund(data["refund_id"], data["order_id"], Money(data["amount"], data["currency"]),
                  data["reason"], datetime.fromisoformat(data["created_at"]), bool(data["processed"]),
                  bool(data.get("restocked", False)), dict(data.get("line_allocations", {})))


def shipment_to_dict(shipment: Shipment) -> dict:
    return {"shipment_id": shipment.shipment_id, "order_id": shipment.order_id, "carrier": shipment.carrier,
            "service": shipment.service, "tracking_number": shipment.tracking_number, "state": shipment.state.value,
            "label_created_at": shipment.label_created_at.isoformat() if shipment.label_created_at else None,
            "zone": shipment.zone, "weight_grams": shipment.weight_grams,
            "label_payload": dict(shipment.label_payload)}


def shipment_from_dict(data: dict) -> Shipment:
    timestamp = data.get("label_created_at")
    return Shipment(data["shipment_id"], data["order_id"], data["carrier"], data["service"],
                    data.get("tracking_number", ""), ShipmentState(data.get("state", "pending")),
                    datetime.fromisoformat(timestamp) if timestamp else None, data.get("zone", "domestic"),
                    int(data.get("weight_grams", 0)), dict(data.get("label_payload", {})))


def encode_product(product: Product) -> str:
    return json_dumps(versioned_payload("product", product_to_dict(product)))


def decode_product(value: str) -> Product:
    return product_from_dict(unpack_payload(json.loads(value), "product"))


def encode_order(order: Order) -> str:
    return json_dumps(versioned_payload("order", order_to_dict(order)))


def decode_order(value: str) -> Order:
    return order_from_dict(unpack_payload(json.loads(value), "order"))


def encode_customer(customer: Customer) -> str:
    return json_dumps(versioned_payload("customer", customer_to_dict(customer)))


def decode_customer(value: str) -> Customer:
    return customer_from_dict(unpack_payload(json.loads(value), "customer"))


def encode_refund(refund: Refund) -> str:
    return json_dumps(versioned_payload("refund", refund_to_dict(refund)))


def decode_refund(value: str) -> Refund:
    return refund_from_dict(unpack_payload(json.loads(value), "refund"))


def encode_shipment(shipment: Shipment) -> str:
    return json_dumps(versioned_payload("shipment", shipment_to_dict(shipment)))


def decode_shipment(value: str) -> Shipment:
    return shipment_from_dict(unpack_payload(json.loads(value), "shipment"))


def dump_many(values: list[dict]) -> str:
    return json.dumps(values, sort_keys=True, separators=(",", ":"))


def load_many(value: str) -> list[dict]:
    result = json.loads(value)
    if not isinstance(result, list) or any(not isinstance(item, dict) for item in result):
        raise ValueError("expected a JSON array of objects")
    return result


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def copy_json(value: object) -> object:
    return json.loads(canonical_json(value))


def json_dumps(value: dict) -> str:
    def encode_special(item):
        if isinstance(item, Decimal):
            return decimal_json(item)
        raise TypeError(f"value of type {type(item).__name__} is not JSON serializable")
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=encode_special)


def decimal_json(value: Decimal) -> str:
    return format(value, "f")


def versioned_payload(entity: str, data: dict, version: int = CURRENT_SCHEMA_VERSION) -> dict:
    if version != CURRENT_SCHEMA_VERSION:
        raise ValueError(f"only schema version {CURRENT_SCHEMA_VERSION} can be written")
    if entity not in {"product", "order", "customer", "shipment", "refund"}:
        raise ValueError(f"unsupported entity type: {entity}")
    return {"schema_version": version, "entity": entity, "data": data}


def migrate_order_payload(payload: dict) -> dict:
    """Convert the original cart-shaped order record into the current line schema."""
    if payload.get("schema_version") == CURRENT_SCHEMA_VERSION:
        return dict(payload["data"])
    if payload.get("schema_version") != 1 or payload.get("entity") != "order":
        raise ValueError("unsupported order payload version")
    old = payload["data"]
    rows = []
    for item in old.get("items", []):
        rows.append({"sku": item["sku"], "description": item.get("name", item["sku"]),
                     "quantity": int(item.get("qty", 1)), "unit_price": int(item["unit_price"]),
                     "currency": old.get("currency", "USD"), "discount": item.get("discount")})
    return {"order_id": old.get("id", old.get("order_id")),
            "customer_id": old.get("customer", old.get("customer_id")),
            "currency": old.get("currency", "USD"), "lines": rows,
            "status": old.get("status", "draft"), "shipping_fee": old.get("shipping"),
            "tax": old.get("tax"), "created_at": old.get("created", old.get("created_at")),
            "revision": int(old.get("revision", 0)), "metadata": dict(old.get("metadata", {})),
            "tax_inclusive": False, "backorder_lines": [], "cancellation_history": []}


def unpack_payload(payload: dict, expected_entity: str) -> dict:
    if "schema_version" not in payload:
        return payload
    if payload.get("entity") != expected_entity:
        raise ValueError(f"expected {expected_entity} payload")
    version = int(payload["schema_version"])
    if expected_entity == "order" and version == 1:
        return migrate_order_payload(payload)
    if version != CURRENT_SCHEMA_VERSION:
        raise ValueError(f"unsupported schema version {version}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ValueError("payload data must be an object")
    return data
