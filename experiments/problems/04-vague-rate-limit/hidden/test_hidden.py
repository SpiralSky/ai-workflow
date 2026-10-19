# Hidden acceptance test: copied in by eval/run.ts after the AI finishes (the AI never sees it).
# The spec is deliberately vague, so accept any limiting behaviour: a call returns falsy, raises,
# is not recorded in `sent`, or blocks (calls don't finish within the timeout).
import importlib, threading, unittest
import messenger

CALLS = 200

class TestHidden(unittest.TestCase):
    def tearDown(self):
        importlib.reload(messenger)  # don't leak limiter state into the visible tests
        messenger.sent.clear()

    def test_burst_is_limited(self):
        messenger.sent.clear()
        limited = []
        def burst():
            for i in range(CALLS):
                try:
                    if not messenger.send_message("u1", f"m{i}"):
                        limited.append(i)
                except Exception:
                    limited.append(i)
        t = threading.Thread(target=burst, daemon=True)
        t.start(); t.join(5)
        self.assertTrue(t.is_alive() or limited or len(messenger.sent) < CALLS, "200 rapid sends were all accepted")
