import json
import unittest
from pathlib import Path
from decimal import Decimal

from fulfil.models import Customer, Money, Order, Product, ProductCode
from fulfil.storage.repositories import RepositorySet
from fulfil.storage.serialization import (
    decode_customer, decode_order, decode_product, decode_refund, decode_shipment,
    customer_from_dict, customer_to_dict, copy_json, decimal_json, dump_many,
    encode_customer, encode_order, encode_product, encode_refund, encode_shipment,
    load_many, order_from_dict, order_to_dict, product_from_dict, product_to_dict,
    refund_from_dict, refund_to_dict, shipment_from_dict, shipment_to_dict,
    migrate_order_payload, unpack_payload, versioned_payload,
)
from fulfil.storage.uow import UnitOfWork

FIXTURES = Path(__file__).parent / "fixtures"


class SerializationTests(unittest.TestCase):
    def test_product_fixture_round_trip_keeps_sku_field(self):
        fixture = json.loads((FIXTURES / "products.json").read_text())
        for data in fixture:
            product = product_from_dict(data)
            self.assertEqual(product_to_dict(product), data)
            encoded = json.loads(encode_product(product))
            self.assertEqual(encoded["schema_version"], 2)
            self.assertEqual(decode_product(json.dumps(encoded)), product)
            self.assertIn("sku", data)

    def test_order_fixture_round_trip_keeps_sku_field(self):
        fixture = json.loads((FIXTURES / "orders.json").read_text())
        for data in fixture:
            order = order_from_dict(data)
            self.assertEqual(order_to_dict(order), data)
            copied = decode_order(encode_order(order))
            self.assertEqual(order_to_dict(copied), data)
            self.assertEqual(data["lines"][0]["sku"], "BOT-ALPINE")

    def test_customer_shipment_refund_fixture_round_trips(self):
        customers = json.loads((FIXTURES / "customers.json").read_text())
        for data in customers:
            item = customer_from_dict(data)
            self.assertEqual(customer_to_dict(item), data)
            self.assertEqual(decode_customer(encode_customer(item)), item)
        shipments = json.loads((FIXTURES / "shipments.json").read_text())
        for data in shipments:
            item = shipment_from_dict(data)
            self.assertEqual(shipment_to_dict(item), data)
            self.assertEqual(decode_shipment(encode_shipment(item)), item)
        refunds = json.loads((FIXTURES / "refunds.json").read_text())
        for data in refunds:
            item = refund_from_dict(data)
            self.assertEqual(refund_to_dict(item), data)
            self.assertEqual(decode_refund(encode_refund(item)), item)

    def test_older_order_schema_is_migrated(self):
        payload = json.loads((FIXTURES / "orders-v1.json").read_text())[0]
        migrated = migrate_order_payload(payload)
        self.assertEqual(migrated["lines"][0]["sku"], "BOT-ALPINE")
        loaded = order_from_dict(unpack_payload(payload, "order"))
        self.assertEqual(loaded.order_id, "ord-old-001")
        self.assertEqual(loaded.lines[0].quantity, 2)

    def test_payload_validation_and_json_copy(self):
        encoded = versioned_payload("product", {"sku": "A"})
        self.assertEqual(unpack_payload(encoded, "product"), {"sku": "A"})
        with self.assertRaises(ValueError):
            unpack_payload(encoded, "order")
        with self.assertRaises(ValueError):
            versioned_payload("product", {}, 1)
        self.assertEqual(copy_json({"decimal": "1.25"}), {"decimal": "1.25"})
        self.assertEqual(dump_many([{"sku": "P-1"}]), '[{"sku":"P-1"}]')
        self.assertEqual(decimal_json(Decimal("2.50")), "2.50")

    def test_bulk_json_helpers_validate_shape(self):
        self.assertEqual(load_many('[{"a":1}]'), [{"a": 1}])
        with self.assertRaises(ValueError):
            load_many("[1, 2]")


class RepositoryTests(unittest.TestCase):
    def setUp(self):
        self.repositories = RepositorySet()
        self.product = Product(ProductCode("p-1"), "Desk Lamp", Money(3250), 3, tags={"home"})
        self.repositories.products.add(self.product)

    def test_repository_returns_copies_and_searches(self):
        loaded = self.repositories.products.get_by_sku(ProductCode("P-1"))
        loaded.stock_on_hand = 99
        self.assertEqual(self.repositories.products.get("p-1").stock_on_hand, 3)
        self.assertEqual(self.repositories.products.search("home")[0].sku, ProductCode("P-1"))
        self.assertTrue(self.repositories.products.sku_exists(ProductCode("p-1"), active_only=True))

    def test_duplicate_and_delete(self):
        with self.assertRaises(KeyError):
            self.repositories.products.add(self.product)
        self.assertTrue(self.repositories.products.delete("p-1"))
        self.assertFalse(self.repositories.products.delete("p-1"))

    def test_unit_of_work_commit_and_rollback(self):
        with UnitOfWork(self.repositories) as work:
            product = self.repositories.products.get("p-1")
            product.change_price(Money(3500))
            self.repositories.products.save(product)
            work.commit()
        with UnitOfWork(self.repositories):
            product = self.repositories.products.get("p-1")
            product.change_price(Money(4000))
            self.repositories.products.save(product)
        self.assertEqual(self.repositories.products.get("p-1").unit_price, Money(3500))

    def test_customer_repository_lookup(self):
        customer = Customer("cus-2", "Rae", "rae@example.test")
        self.repositories.customers.add(customer)
        self.assertEqual(self.repositories.customers.by_email("RAE@example.test"), customer)
        self.assertEqual(self.repositories.customers.name_prefix("r"), [customer])


if __name__ == "__main__":
    unittest.main()
