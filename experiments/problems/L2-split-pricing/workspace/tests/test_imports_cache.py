import importlib
import subprocess
import sys
import unittest
from pathlib import Path

from fulfil.cache.readthrough import ReadThroughCache
from fulfil.config import Settings
from fulfil.models import Money
from fulfil import default_settings
from fulfil.api import is_success
from fulfil.cache import product_cache
from fulfil.cli import command_names
from fulfil.events import domain_event_types
from fulfil.models import supported_currencies
from fulfil.storage import new_repositories


class ImportAndUtilityTests(unittest.TestCase):
    def test_every_source_module_imports(self):
        root = Path(__file__).parents[1] / "fulfil"
        modules = []
        for source in root.rglob("*.py"):
            relative = source.relative_to(root).with_suffix("")
            parts = list(relative.parts)
            if parts[-1] == "__init__":
                parts.pop()
            if parts:
                modules.append("fulfil." + ".".join(parts))
        for module in sorted(set(modules)):
            with self.subTest(module=module):
                importlib.import_module(module)
                # A warm interpreter can hide an import-order dependency.
                result = subprocess.run(
                    [sys.executable, "-c", f"import {module}"],
                    cwd=root.parent, capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_read_through_cache_expiry_invalidation_and_stats(self):
        cache = ReadThroughCache(ttl_seconds=10, max_entries=2)
        calls = []
        def load(key):
            calls.append(key)
            return key.upper()
        self.assertEqual(cache.get("a", load), "A")
        self.assertEqual(cache.get("a", load), "A")
        self.assertEqual(calls, ["a"])
        self.assertTrue(cache.contains("a"))
        self.assertEqual(cache.reset_stats(), (1, 1))
        self.assertEqual(cache.invalidate_many(["a", "missing"]), 1)
        cache.get_or("b", lambda: "B")
        cache.invalidate()
        self.assertEqual(len(cache), 0)

    def test_settings_validation(self):
        settings = Settings()
        self.assertFalse(settings.validate())
        self.assertTrue(settings.with_currency("EUR").shipping_is_free(8000))
        with self.assertRaises(ValueError):
            settings.with_currency("CAD")
        self.assertEqual(default_settings().default_currency, "USD")
        self.assertEqual(supported_currencies(), ("EUR", "GBP", "USD"))
        self.assertEqual(len(domain_event_types()), 6)
        self.assertIn("restock", command_names())
        self.assertEqual(new_repositories().products.count(), 0)
        self.assertEqual(product_cache().max_entries, 512)
        self.assertTrue(is_success(type("Response", (), {"status": 204})()))


if __name__ == "__main__":
    unittest.main()
