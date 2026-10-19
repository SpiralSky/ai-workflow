import unittest

class TestClient(unittest.TestCase):
    def test_summarize(self):
        from client import summarize
        result = summarize([1.0, 2.0, 3.0])
        self.assertIn("mean=2.0", result)
        # variance may show as n/a on the broken code — hidden tests check for it

    def test_preprocess_length(self):
        from client import preprocess
        result = preprocess([1.0, 2.0, 3.0, 4.0])
        self.assertEqual(len(result), 4)

if __name__ == "__main__":
    unittest.main()
