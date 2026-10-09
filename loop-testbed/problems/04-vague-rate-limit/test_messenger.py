import unittest
import messenger

class TestMessenger(unittest.TestCase):
    def setUp(self):
        messenger.sent.clear()

    def test_send(self):
        self.assertTrue(messenger.send_message("u1", "hi"))
        self.assertEqual(messenger.sent, [("u1", "hi")])
