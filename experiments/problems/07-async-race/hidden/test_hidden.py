import unittest, threading

class TestQueueConcurrent(unittest.TestCase):
    def test_lock_exists(self):
        """Deterministic: TaskQueue source must contain a Lock."""
        from queue_module import TaskQueue
        import inspect
        src = inspect.getsource(TaskQueue)
        self.assertTrue(
            "Lock" in src or "RLock" in src,
            "TaskQueue must use threading.Lock or RLock for thread safety"
        )

    def test_concurrent_counter(self):
        """_processed must be accurate under concurrent consumers."""
        from queue_module import TaskQueue
        N = 300
        q = TaskQueue()
        for i in range(N):
            q.add(i)
        barrier = threading.Barrier(3)
        results = []

        def consume():
            barrier.wait()
            q.process_all(lambda x: results.append(x))

        threads = [threading.Thread(target=consume) for _ in range(3)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=3)

        self.assertEqual(q.processed_total, N,
            f"processed_total={q.processed_total} != {N}; items_processed={len(results)}")
        self.assertEqual(len(results), N,
            f"Expected {N} results, got {len(results)}")

if __name__ == "__main__":
    unittest.main()

