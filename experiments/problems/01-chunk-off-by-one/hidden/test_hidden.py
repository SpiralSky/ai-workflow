# Hidden acceptance test: copied in by eval/run.ts after the AI finishes (the AI never sees it).
import unittest
from chunks import chunk

class TestHidden(unittest.TestCase):
    def test_remainder(self):
        self.assertEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
        self.assertEqual(chunk([1, 2], 5), [[1, 2]])
        self.assertEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]])
        self.assertEqual(chunk([], 3), [])
