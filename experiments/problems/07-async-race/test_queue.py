import unittest

class TestQueueBasic(unittest.TestCase):
    def test_single_thread(self):
        from queue_module import TaskQueue
        q = TaskQueue()
        q.add(1)
        q.add(2)
        q.add(3)
        results = []
        n = q.process_all(results.append)
        self.assertEqual(n, 3)
        self.assertEqual(results, [1, 2, 3])
        self.assertEqual(q.processed_total, 3)

if __name__ == "__main__":
    unittest.main()
