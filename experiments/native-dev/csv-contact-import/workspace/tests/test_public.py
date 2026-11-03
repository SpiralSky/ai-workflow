import unittest
from importer import import_contacts
from summary import render
class PublicTests(unittest.TestCase):
    def test_simple(self): self.assertEqual(render('name,email\nAda,a@b'), 'Ada <a@b>')
    def test_quote(self): self.assertEqual(import_contacts('name,email\n"Doe, Jane",j@b')[0]['name'],'Doe, Jane')
