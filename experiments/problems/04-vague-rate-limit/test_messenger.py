import unittest
import unittest.mock  # needed for Python 3.14+ where mock is not auto-imported
import messenger

class TestMessenger(unittest.TestCase):
    def setUp(self):
        messenger.sent.clear()

    def test_send(self):
        self.assertTrue(messenger.send_message("u1", "hi"))
        self.assertEqual(messenger.sent, [("u1", "hi")])
