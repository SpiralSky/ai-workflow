"""Public behavior and requested structure, independent of the reference patch."""
import ast
import importlib
import unittest
from pathlib import Path

PUBLIC_NAMES = ['BuyXGetY', 'CategoryPriceRule', 'FixedDiscount', 'MinimumQuantityRule', 'PercentageDiscount', 'PriceBand', 'PriceBook', 'PriceQuote', 'PriceRule', 'PricingContext', 'PricingEngine', 'Promotion', 'PromotionBook', 'PromotionUsage', 'SkuPriceRule', 'TaxPolicy', 'allocate_discount', 'apply_coupon_stack', 'apply_rules', 'apply_tax_exemptions', 'assert_same_currency', 'basket_minimum', 'best_single_promotion', 'calculate_tax_by_line', 'cap_line_discount', 'cart_discount_cap', 'chargeable_weight_grams', 'choose_shipping_rate', 'combine_duplicate_lines', 'compare_quotes', 'compare_unit_prices', 'currency_increment', 'discount_allocation', 'discount_basis', 'discount_over_limit', 'discount_percent', 'effective_unit_price', 'exempt_order_amount', 'free_shipping_eligible', 'line_discount_for_display', 'line_fingerprint', 'line_is_tax_exempt', 'margin_percent', 'merge_tax_policies', 'normalize_promotion_code', 'order_taxable_total', 'percent_of', 'percentage_of_tax_inclusive', 'per_unit_discount', 'price_breaks', 'price_for_product', 'price_with_margin', 'price_with_markup', 'promotion_candidate_order', 'promotion_is_expired', 'promotion_savings', 'quote_breakdown', 'round_cash_amount', 'round_minor', 'round_percentage', 'round_to_increment', 'rule_effective_date', 'savings_rate', 'service_fee', 'shipping_discount', 'shipping_tax', 'split_minor', 'surcharge_for_remote_postcode', 'tax_for', 'tax_included_amount', 'tax_rate_for', 'tax_summary', 'taxable_subtotal', 'total_lines', 'validate_quote', 'validate_rule_set']
GROUPS = {
    "rules": ("PriceRule", "PricingContext", "MinimumQuantityRule", "SkuPriceRule", "CategoryPriceRule", "PriceBand", "PriceBook", "apply_rules", "price_for_product", "price_breaks", "rule_effective_date", "validate_rule_set"),
    "promotions": ("Promotion", "PercentageDiscount", "FixedDiscount", "BuyXGetY", "PromotionBook", "PromotionUsage", "allocate_discount", "apply_coupon_stack", "normalize_promotion_code", "discount_percent", "cart_discount_cap", "promotion_savings", "promotion_candidate_order", "best_single_promotion", "promotion_is_expired", "discount_allocation"),
    "tax": ("TaxPolicy", "tax_for", "taxable_subtotal", "calculate_tax_by_line", "shipping_tax", "percentage_of_tax_inclusive", "tax_summary", "merge_tax_policies", "tax_rate_for", "order_taxable_total", "line_is_tax_exempt", "apply_tax_exemptions", "tax_included_amount", "exempt_order_amount"),
    "rounding": ("round_minor", "round_to_increment", "split_minor", "currency_increment", "round_percentage", "round_cash_amount"),
}


def pricing_graph():
    """Resolve relative and absolute imports between pricing source modules."""
    modules = {}
    for path in Path("fulfil/pricing").rglob("*.py"):
        parts = list(path.with_suffix("").parts)
        package = parts[-1] == "__init__"
        if package:
            parts.pop()
        modules[".".join(parts)] = (path, package)
    graph = {name: set() for name in modules}
    for name, (path, package) in modules.items():
        parent = name.split(".") if package else name.split(".")[:-1]
        for node in ast.walk(ast.parse(path.read_text())):
            targets = []
            if isinstance(node, ast.Import):
                targets = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    prefix = parent[:len(parent) - node.level + 1]
                    target = ".".join(prefix + ((node.module or "").split(".") if node.module else []))
                else:
                    target = node.module or ""
                targets = [target] + [target + "." + alias.name for alias in node.names]
            graph[name].update(target for target in targets if target in modules)
    return graph


class SplitPricingTests(unittest.TestCase):
    def test_group_modules_own_their_implementations(self):
        for group, names in GROUPS.items():
            with self.subTest(group=group):
                path = Path("fulfil/pricing") / (group + ".py")
                self.assertTrue(path.is_file(), str(path))
                tree = ast.parse(path.read_text())
                defined = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef))}
                module = importlib.import_module("fulfil.pricing." + group)
                for name in names:
                    self.assertIn(name, defined, group + "." + name + " must be defined here, not re-exported")
                    self.assertEqual(getattr(module, name).__module__, module.__name__)

    def test_all_previous_public_imports_remain(self):
        module = importlib.import_module("fulfil.pricing")
        for name in PUBLIC_NAMES:
            with self.subTest(name=name):
                self.assertTrue(callable(getattr(module, name)))
        namespace = {}
        exec("from fulfil.pricing import *", namespace)
        self.assertTrue(set(PUBLIC_NAMES).issubset(namespace))

    def test_every_pricing_module_is_small(self):
        for path in Path("fulfil/pricing").rglob("*.py"):
            with self.subTest(path=str(path)):
                self.assertLessEqual(len(path.read_text().splitlines()), 350)

    def test_no_pricing_import_cycle(self):
        graph = pricing_graph()
        done, visiting = set(), set()
        def visit(name):
            self.assertNotIn(name, visiting, "import cycle at " + name)
            if name in done:
                return
            visiting.add(name)
            for dependency in graph[name]:
                visit(dependency)
            visiting.remove(name)
            done.add(name)
        for name in graph:
            visit(name)
