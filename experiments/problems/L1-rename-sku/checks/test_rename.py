import importlib
import io
import tokenize
import unittest
import hashlib
from pathlib import Path

MODULES = ['fulfil.api.handlers', 'fulfil.api.schemas', 'fulfil.cli.commands', 'fulfil.events.types', 'fulfil.models', 'fulfil.models.fulfillment', 'fulfil.models.order', 'fulfil.models.product', 'fulfil.pricing.pricing', 'fulfil.reports.revenue', 'fulfil.reports.stock', 'fulfil.services.inventory', 'fulfil.services.invoicing', 'fulfil.services.orders', 'fulfil.services.refunds', 'fulfil.storage.repositories', 'fulfil.storage.serialization']
FIXTURES = {'fixtures/customers.json': '9a6a07cfd4d4950a494dec23819fe3694d58a48c42fc63030e675e6e19e95182', 'fixtures/shipments.json': 'beab874fc66a9469cebb677f4eed05e5e773856d3642866f26fa6f47ee3ab22d', 'fixtures/orders.json': '7d5c7358e88c946fae92002277ebe497fed3ac0b7708360a3637c695a52ce5d5', 'fixtures/orders-v1.json': '822908501224ac7baa19780d64f5825e5674295d0b285de3b52413cf43cbcad2', 'fixtures/products.json': '1c6959151379ab504fbc26a41c135364653def75f4e82680187629cbe8d1e240', 'fixtures/refunds.json': '3f3bb35ccc647c6b934bc2eb55627e398511e78bb411fe567ef1903f88bc1289'}

class RenameTests(unittest.TestCase):
    def test_public_type_locations(self):
        from fulfil.models.product import ProductCode
        for name in MODULES:
            with self.subTest(module=name):
                self.assertIs(getattr(importlib.import_module(name), "ProductCode"), ProductCode)
        self.assertEqual(str(ProductCode(" ab-12 ")), "AB-12")

    def test_no_old_identifier(self):
        for source in Path("fulfil").rglob("*.py"):
            tokens = tokenize.generate_tokens(io.StringIO(source.read_text()).readline)
            self.assertFalse(any(t.type == tokenize.NAME and t.string == "Sku" for t in tokens), str(source))

    def test_stored_fixtures_unchanged(self):
        for relative, expected in FIXTURES.items():
            self.assertEqual(hashlib.sha256((Path("tests") / relative).read_bytes()).hexdigest(), expected)
