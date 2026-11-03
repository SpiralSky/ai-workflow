import unittest
from loader import load_config
from app import describe
class PublicTests(unittest.TestCase):
    def test_defaults(self): self.assertEqual(describe({}), 'localhost:8080 (normal)')
    def test_types(self): self.assertEqual(load_config({'port':'80','debug':'false'}), {'host':'localhost','port':80,'debug':False})
