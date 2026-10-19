import unittest

class TestClientHidden(unittest.TestCase):
    def test_summarize_includes_variance(self):
        from client import summarize
        result = summarize([1.0, 2.0, 3.0, 4.0, 5.0])
        self.assertIn("mean=3.0", result)
        self.assertNotIn("n/a", result, "variance must be computed, not n/a")
        self.assertIn("variance=2.0", result)

    def test_preprocess_zscore(self):
        from client import preprocess
        result = preprocess([2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0])
        self.assertEqual(len(result), 8)
        # z-score of the mean should be 0.0
        mean_z = sum(result) / len(result)
        self.assertAlmostEqual(mean_z, 0.0, places=5)

    def test_no_unexpected_errors(self):
        from client import summarize, preprocess
        # Both functions must run without TypeError
        try:
            summarize([10.0, 20.0])
            preprocess([1.0, 3.0, 5.0])
        except TypeError as e:
            self.fail(f"TypeError (likely wrong kwarg): {e}")

if __name__ == "__main__":
    unittest.main()
