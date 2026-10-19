# Hidden acceptance test: copied in by eval/run.ts after the AI finishes (the AI never sees it).
import pathlib, unittest
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

class TestHidden(unittest.TestCase):
    def test_output_unchanged(self):
        out = build_report([("widgets", 120), ("gadgets", 30.5)], [("rent", 100)], [("widgets", 20)])
        self.assertEqual(out, EXPECTED)

    def test_empty_sections(self):
        self.assertEqual(build_report([], [], []),
                         "== Sales ==\n  TOTAL          0.00\n\n== Costs ==\n  TOTAL          0.00\n\n== Refunds ==")

    def test_deduplicated(self):
        src = pathlib.Path("report.py").read_text()
        self.assertLess(src.count("total += amt"), 2, "sales/costs formatters still copy-pasted")
