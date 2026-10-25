import unittest
from chunks import chunk

class TestHiddenChunk(unittest.TestCase):
    def test_remainder_edge(self):
        self.assertEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
        self.assertEqual(chunk([1, 2], 5), [[1, 2]])
        self.assertEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])
        self.assertEqual(chunk([], 3), [])

if __name__ == "__main__":
    unittest.main()
