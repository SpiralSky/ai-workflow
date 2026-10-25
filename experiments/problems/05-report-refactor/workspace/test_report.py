import unittest
from report import build_report

EXPECTED = """== Sales ==
  widgets      120.00
  gadgets       30.50
  TOTAL        150.50

== Costs ==
  rent         100.00
  TOTAL        100.00

== Refunds ==
  widgets      -20.00"""

class TestReport(unittest.TestCase):
    def test_output_unchanged(self):
        out = build_report(
            [("widgets", 120), ("gadgets", 30.5)],
            [("rent", 100)],
            [("widgets", 20)],
        )
        self.assertEqual(out, EXPECTED)
