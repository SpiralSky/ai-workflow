import base64
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from restore_source import restore, validate_tree, verify_blob, git, TREE, BLOBS


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        git(self.repo, 'init', '--quiet')
        self.data = b'reviewed content\n'
        self.sha = git(self.repo, 'hash-object', '-w', '--stdin', data=self.data).decode().strip()
        git(self.repo, 'update-index', '--add', '--cacheinfo', '100644', self.sha, 'file.txt')
        self.tree = git(self.repo, 'write-tree').decode().strip()
        self.document = {'sha': self.tree, 'truncated': False, 'tree': [
            {'path': 'file.txt', 'type': 'blob', 'mode': '100644', 'sha': self.sha, 'size': len(self.data)}]}

    def test_success_reuses_verified_local_blob_without_blob_request(self):
        def read(resource):
            self.assertTrue(resource.startswith('trees/'))
            return self.document
        dest = self.root / 'result'
        restore(self.repo, dest, read, self.tree, 1)
        self.assertEqual((dest / 'file.txt').read_bytes(), self.data)

    def test_corrupted_remote_blob_fails_before_materialization(self):
        empty = self.root / 'empty'; empty.mkdir(); git(empty, 'init', '--quiet')
        def read(resource):
            return self.document if resource.startswith('trees/') else {
                'sha': self.sha, 'encoding': 'base64', 'content': base64.b64encode(b'X' * len(self.data)).decode()}
        dest = self.root / 'result'
        with self.assertRaisesRegex(ValueError, 'Blob hash mismatch'):
            restore(empty, dest, read, self.tree, 1)
        self.assertFalse((dest / 'file.txt').exists())

    def test_path_traversal_and_unsupported_modes(self):
        for name in ['/outside', '../outside', 'safe/../outside', '.git/config', 'safe/.GIT/config', 'a\\b', './file', 'a//b']:
            with self.subTest(name=name):
                doc = copy.deepcopy(self.document); doc['tree'][0]['path'] = name
                with self.assertRaises(ValueError): validate_tree(doc, self.tree, 1)
        for mode in ['120000', '160000']:
            doc = copy.deepcopy(self.document); doc['tree'][0]['mode'] = mode
            with self.assertRaises(ValueError): validate_tree(doc, self.tree, 1)

    def test_unavailable_tree_never_creates_destination(self):
        def read(resource): raise FileNotFoundError('immutable tree unavailable')
        dest = self.root / 'result'
        with self.assertRaises(FileNotFoundError): restore(self.repo, dest, read, self.tree, 1)
        self.assertFalse(dest.exists())

    def test_root_mismatch_never_materializes_source(self):
        wrong = 'a' * 40
        doc = copy.deepcopy(self.document); doc['sha'] = wrong
        dest = self.root / 'result'
        with self.assertRaisesRegex(ValueError, 'Final root tree mismatch'):
            restore(self.repo, dest, lambda _: doc, wrong, 1)
        self.assertFalse((dest / 'file.txt').exists())


if __name__ == '__main__': unittest.main()
