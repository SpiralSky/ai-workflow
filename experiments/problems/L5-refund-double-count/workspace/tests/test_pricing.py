import unittest
from datetime import datetime, timezone
from decimal import Decimal

from fulfil.models import Money, Order, OrderLine, Product, Sku
from fulfil.pricing import (
    BuyXGetY, CategoryPriceRule, FixedDiscount, MinimumQuantityRule, PercentageDiscount,
    PriceBand, PriceBook, PricingContext, PricingEngine, Promotion, PromotionBook, PromotionUsage,
    SkuPriceRule, TaxPolicy, allocate_discount, apply_coupon_stack, apply_rules,
    apply_tax_exemptions, assert_same_currency, basket_minimum, best_single_promotion,
    calculate_tax_by_line, cap_line_discount, cart_discount_cap, chargeable_weight_grams,
    choose_shipping_rate, combine_duplicate_lines, compare_quotes, compare_unit_prices,
    currency_increment, discount_allocation, discount_basis, discount_over_limit,
    discount_percent, effective_unit_price, exempt_order_amount, free_shipping_eligible,
    line_discount_for_display, line_fingerprint, line_is_tax_exempt, margin_percent,
    merge_tax_policies, normalize_promotion_code, order_taxable_total, percent_of,
    percentage_of_tax_inclusive, per_unit_discount, price_breaks, price_for_product,
    price_with_margin, price_with_markup, promotion_candidate_order, promotion_is_expired,
    promotion_savings, quote_breakdown, round_cash_amount, round_minor, round_percentage,
    round_to_increment, rule_effective_date, savings_rate, service_fee, shipping_discount,
    shipping_tax, split_minor, surcharge_for_remote_postcode, tax_for, tax_included_amount,
    tax_rate_for, tax_summary, taxable_subtotal, total_lines, validate_quote, validate_rule_set,
)


class PricingTests(unittest.TestCase):
    def setUp(self):
        self.sku = Sku("desk-1")
        self.lines = [OrderLine(self.sku, "Desk", 2, Money(1000)),
                      OrderLine(Sku("chair-1"), "Chair", 1, Money(2500))]
        self.order = Order("ord-2", "cus-2", "USD", list(self.lines))

    def test_quote_calculates_shipping_tax_and_total(self):
        quote = PricingEngine().quote(self.order)
        self.assertEqual(quote.subtotal, Money(4500))
        self.assertEqual(quote.shipping, Money(595))
        self.assertEqual(quote.tax, Money(371))
        validate_quote(quote)
        self.assertEqual(quote.total, Money(5466))

    def test_promotions_apply_and_respect_eligibility(self):
        promotion = PercentageDiscount(" save10 ", "save ten", percentage=Decimal("10"),
                                       channels=frozenset({"web"}))
        book = PromotionBook([promotion])
        discounted, selected = book.evaluate("SAVE10", self.lines,
                                             PricingContext("USD", customer_id="cus-2"))
        self.assertEqual(selected, promotion)
        self.assertEqual(sum(line.subtotal.minor for line in discounted), 4050)
        with self.assertRaises(ValueError):
            book.evaluate("UNKNOWN", self.lines, PricingContext("USD"))

    def test_fixed_discount_is_allocated_without_exceeding_lines(self):
        promotion = FixedDiscount("TAKE5", "five dollars", amount=Money(500))
        discounted = promotion.discount(self.lines, PricingContext("USD"))
        self.assertEqual(sum(line.discount.minor for line in discounted), 500)
        self.assertEqual(allocate_discount(self.lines, 9000, "USD")[0].subtotal.minor, 0)

    def test_quantity_rule_and_price_book(self):
        rule = MinimumQuantityRule(2, Decimal("15"))
        changed = rule.apply(self.lines[0], PricingContext("USD"))
        self.assertEqual(changed.subtotal.minor, 1700)
        book = PriceBook()
        book.add(self.sku, PriceBand(1, Money(1100)))
        book.add(self.sku, PriceBand(5, Money(950)))
        self.assertEqual(book.price(self.sku, 6), Money(950))

    def test_rounding_tax_and_money_calculations(self):
        self.assertEqual(round_minor(Decimal("2.5")), 3)
        self.assertEqual(round_minor(Decimal("2.9"), "down"), 2)
        self.assertEqual(tax_for(Money(10000), "US-CA"), Money(825))
        self.assertEqual(percent_of(Money(1000), 10), Money(100))
        self.assertEqual(price_with_margin(Money(600), Decimal("40")), Money(1000))
        self.assertEqual([part.minor for part in split_minor(Money(10), [1, 1, 1])], [4, 3, 3])

    def test_best_promotion_and_custom_policy(self):
        promos = [PercentageDiscount("A", "ten", percentage=Decimal("10")),
                  FixedDiscount("B", "seven dollars", amount=Money(700))]
        lines, selected = best_single_promotion(self.lines, promos, PricingContext("USD"))
        self.assertEqual(selected.code, "B")
        self.assertEqual(sum(line.subtotal.minor for line in lines), 3800)
        custom = TaxPolicy("TEST", Decimal("0.05"), shipping_taxable=True)
        quote = PricingEngine(policies={"TEST": custom}).quote(self.order, region="TEST")
        self.assertEqual(quote.tax, Money(255))

    def test_rule_groups_tiered_prices_and_product_pricing(self):
        product = Product(self.sku, "Desk", Money(1000), 20)
        self.assertEqual(price_for_product(product, 2).quantity, 2)
        bands = PriceBook()
        created = bands.add_tiers(self.sku, Money(1000), [1, 2, 3], Decimal("0.1"))
        self.assertEqual([row.unit_price.minor for row in created], [1000, 900, 800])
        self.assertEqual(bands.price(self.sku, 3), Money(800))
        self.assertTrue(created[1].matches(3, "retail", datetime.now(timezone.utc)))
        self.assertEqual(len(bands.bands(self.sku)), 3)
        self.assertTrue(bands.remove(self.sku, "retail", 2))
        self.assertFalse(bands.remove(self.sku, "retail", 2))
        rule = SkuPriceRule(self.sku, Money(875))
        context = PricingContext("USD", tags=frozenset({"featured"}))
        category = CategoryPriceRule("featured", Decimal("10"))
        self.assertEqual(apply_rules([self.lines[0]], [category], context)[0].subtotal, Money(1800))
        self.assertEqual(apply_rules([self.lines[0]], [rule], context)[0].unit_price, Money(875))
        self.assertEqual(validate_rule_set([rule]), [])
        self.assertIn("volume", MinimumQuantityRule(2, Decimal("10")).name)

    def test_coupon_stack_usage_and_limits(self):
        context = PricingContext("USD", customer_id="cus-2")
        first = PercentageDiscount("TEN", "ten percent", percentage=Decimal("10"), combinable=True)
        second = FixedDiscount("FIVE", "five dollars", amount=Money(500), combinable=True,
                               minimum_subtotal=Money(1000), usage_limit=1)
        book = PromotionBook([first, second])
        stack = apply_coupon_stack(self.lines, [first, second], context)
        self.assertEqual(total_lines(stack).minor, 3550)
        self.assertTrue(basket_minimum(self.lines, Money(4500)))
        self.assertEqual(normalize_promotion_code(" ten "), "TEN")
        self.assertEqual(book.automatic(), [])
        discounted, selected = book.evaluate("FIVE", self.lines, context)
        self.assertEqual(selected, second)
        self.assertEqual(book.usage.used(second), 1)
        self.assertFalse(book.usage.available(second))
        with self.assertRaises(ValueError):
            book.evaluate("FIVE", self.lines, context)
        self.assertEqual(book.usage.release(second), 0)
        with self.assertRaises(ValueError):
            apply_coupon_stack(self.lines, [first, PercentageDiscount("X", "x", percentage=Decimal(5))], context)
        self.assertTrue(promotion_is_expired(Promotion("OLD", "old", ends_at=datetime(2020, 1, 1,
                                                                                   tzinfo=timezone.utc))))

    def test_tax_exemptions_inclusive_regions_and_rounding(self):
        policy = TaxPolicy("TEST", Decimal("0.2"), shipping_taxable=True)
        exemptions = {self.sku}
        self.assertTrue(line_is_tax_exempt(self.lines[0], exemptions))
        self.assertEqual(exempt_order_amount(self.lines, exemptions), Money(2000))
        self.assertEqual(taxable_subtotal(self.lines, exemptions), Money(2500))
        self.assertEqual(apply_tax_exemptions(self.lines, policy, exemptions), Money(500))
        self.assertEqual(tax_summary([self.lines[1]], policy)[0], Money(500))
        self.assertEqual(calculate_tax_by_line([self.lines[1]], policy)[self.lines[1].sku], Money(500))
        self.assertEqual(tax_included_amount(Money(1200), TaxPolicy("GB", Decimal(".2"), tax_inclusive=True)),
                         Money(200))
        self.assertEqual(percentage_of_tax_inclusive(Money(1200), Decimal(".2")), Money(200))
        self.assertEqual(tax_for(Money(1000), "US-CA"), Money(83))
        self.assertEqual(tax_rate_for("US-CA"), Decimal(".0825"))
        self.assertEqual(order_taxable_total(self.order, policy), Money(900))
        self.assertEqual(shipping_tax(policy, Money(500)), Money(100))
        self.assertEqual(merge_tax_policies({}, {"TEST": policy})["TEST"], policy)
        self.assertEqual(currency_increment("USD"), 1)
        self.assertEqual(round_to_increment(Money(103), 5), Money(105))
        self.assertEqual(round_cash_amount(Money(103), "USD"), Money(105))
        self.assertEqual(round_minor(Decimal("4.5")), 5)
        self.assertEqual(round_percentage(Decimal("12.345")), Decimal("12.35"))
        self.assertEqual(chargeable_weight_grams(450, 12000), 450)

    def test_discount_allocation_shipping_and_quote_helpers(self):
        capped = cart_discount_cap(self.lines, Decimal("50"), Money(300))
        self.assertEqual(sum(line.discount.minor for line in capped), 300)
        changed, savings = discount_percent(self.lines, Decimal("10"))
        self.assertEqual(savings, Money(450))
        self.assertTrue(discount_over_limit(changed, Money(100)))
        self.assertEqual(discount_basis(self.lines, self.sku), Money(2000))
        self.assertEqual(discount_allocation(self.lines, Money(450)), {"DESK-1#0": 200, "CHAIR-1#1": 250})
        self.assertEqual(line_fingerprint(self.lines[0]), ("DESK-1", 2, 1000, 0))
        self.assertEqual(line_discount_for_display(changed[0]), "10.0% off")
        self.assertEqual(effective_unit_price(changed[0]), Money(900))
        self.assertEqual(per_unit_discount(changed[0]), Money(100))
        self.assertEqual(cap_line_discount(self.lines[0], Money(500)).discount, Money(500))
        self.assertEqual(combine_duplicate_lines(self.lines + [self.lines[0]])[0].quantity, 4)
        self.assertEqual(shipping_discount(Money(500), Money(200)), Money(300))
        self.assertTrue(free_shipping_eligible(Money(5000), Money(5000)))
        self.assertEqual(surcharge_for_remote_postcode("AK 99501", Money(400), ("AK",)), Money(400))
        self.assertEqual(service_fee(Money(10000), 125), Money(125))
        self.assertEqual(choose_shipping_rate(Money(5000), Money(500), Money(900)), Money(500))
        assert_same_currency([Money(1), Money(2)], "USD")
        self.assertEqual(savings_rate(Money(1000), Money(900)), Decimal("10.00"))
        self.assertFalse(discount_over_limit(self.lines, Money(1)))

    def test_pricing_engine_extensions_and_public_read_models(self):
        automatic = PercentageDiscount("AUTO", "auto sale", percentage=Decimal("5"), automatic=True)
        engine = PricingEngine(promotions=PromotionBook([automatic]))
        result = engine.quote(self.order)
        self.assertEqual(result.promotion_code, "AUTO")
        self.assertEqual(result.total.minor, 5223)
        self.assertIn("promotion:AUTO", result.notes)
        self.assertEqual(engine.explain(self.order)[-1], "promotion:AUTO")
        self.assertEqual(quote_breakdown(result)["total"], result.total.minor)
        validate_quote(result)
        self.assertEqual(compare_quotes(result, result), 0)
        self.assertEqual(compare_unit_prices(Money(100), 2, Money(75), 1), -1)
        self.assertEqual(price_with_margin(Money(600), Decimal(40)), Money(1000))
        self.assertEqual(price_with_markup(Money(1000), Decimal(20)), Money(1200))
        self.assertEqual(margin_percent(Money(600), Money(1000)), Decimal("40.00"))
        self.assertEqual(promotion_savings(self.lines, discount_percent(self.lines, Decimal(10))[0]), Money(450))
        self.assertEqual(compare_quotes(result, engine.quote(self.order)), 0)
        self.assertEqual(total_lines(self.lines), Money(4500))
        self.assertEqual(percent_of(Money(2000), 10), Money(200))
        self.assertEqual(currency_increment("GBP"), 1)

    def test_misc_shipping_rules_and_currency_guards(self):
        self.assertEqual(price_breaks(Money(1000), [1, 2], Decimal("0.1"))[2], Money(900))
        self.assertEqual(discount_percent(self.lines, Decimal("5"))[1], Money(225))
        self.assertEqual(round_cash_amount(Money(103, "GBP"), "GBP"), Money(103, "GBP"))
        self.assertEqual(surcharge_for_remote_postcode("94612", Money(450), ("AK",)), Money(0))
        self.assertEqual(free_shipping_eligible(Money(1), Money(2)), False)
        with self.assertRaises(ValueError):
            assert_same_currency([Money(5, "EUR")], "USD")
        with self.assertRaises(ValueError):
            currency_increment("CAD")
        with self.assertRaises(ValueError):
            round_cash_amount(Money(100, "EUR"), "USD")
        with self.assertRaises(ValueError):
            choose_shipping_rate(Money(1), Money(1, "EUR"), Money(2, "EUR"))


if __name__ == "__main__":
    unittest.main()
