1. Read queue_module.py
2. Notice missing lock on shared mutable state
3. Add self._lock = threading.Lock() in __init__
4. Wrap add() and the body of process_all() with the lock
5. Run tests
