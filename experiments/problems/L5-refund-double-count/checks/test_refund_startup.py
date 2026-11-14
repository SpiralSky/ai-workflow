import os
from pathlib import Path
import subprocess
import sys
import unittest


class RefundStartupTests(unittest.TestCase):
    def test_import_orders_and_independent_buses(self):
        source = (Path(__file__).parent / "refund_scenario.py").read_text()
        for scenario in ("api-only", "cli-first", "api-first", "reports-first", "unregistered"):
            with self.subTest(scenario=scenario):
                result = subprocess.run([sys.executable, "-B", "-c", source, scenario],
                                        capture_output=True, text=True, timeout=8,
                                        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
