import unittest
from window import query_events
from event_store import EventStore
from report import render_window
class PublicTests(unittest.TestCase):
    def test_order(self):
        rows=[dict(id='b',timestamp='2026-01-02T00:00:00Z'),dict(id='a',timestamp='2026-01-01T00:00:00Z')]
        self.assertEqual([r['id'] for r in query_events(rows)],['a','b'])
    def test_report(self):
        self.assertEqual(render_window(EventStore([])), '')
