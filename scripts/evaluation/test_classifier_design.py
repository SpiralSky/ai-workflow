"""Offline adversarial regression tests for the frozen comparison draft."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import check_classifier_design as checker


class DesignChecks(unittest.TestCase):
    def setUp(self):
        self.design = checker.parse(checker.read_bounded(checker.DESIGN))

    def reject(self, value):
        with self.assertRaises(checker.DesignError):
            checker.check(value)

    def test_self_test_gate_rejects_empty_skipped_and_incomplete_results(self):
        result = unittest.TestResult()
        self.assertFalse(checker.self_tests_complete(checker.self_test_summary(result)))
        result.testsRun = 1
        self.assertTrue(checker.self_tests_complete(checker.self_test_summary(result)))
        for field in ('failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses'):
            with self.subTest(field=field):
                setattr(result, field, [('synthetic', 'incomplete')])
                self.assertFalse(checker.self_tests_complete(checker.self_test_summary(result)))
                setattr(result, field, [])

    def test_self_test_cli_rejects_skips_even_when_unittest_reports_success(self):
        outcome = unittest.TestResult()
        outcome.testsRun = 1
        outcome.skipped = [('synthetic', 'skip')]
        self.assertTrue(outcome.wasSuccessful())
        with patch.object(sys, 'argv', ['checker', '--self-test']), \
             patch.object(checker.unittest.defaultTestLoader, 'discover'), \
             patch.object(checker.unittest.TextTestRunner, 'run', return_value=outcome), \
             patch.object(checker.sys, 'stderr'):
            self.assertEqual(checker.main(), 1)

    def test_exact_design_and_reordered_cells(self):
        for cells in (self.design['cells'], self.design['cells'][::-1]):
            self.design['cells'] = cells
            result = checker.check(self.design)
            self.assertEqual(result['targetCellsPerArm'], 60)
            for flag in ('campaignReady', 'readyForLiveCalls', 'fixtureManifestVerified',
                         'modelQualityMeasured', 'planApproved'):
                self.assertIs(result[flag], False)

    def test_every_frozen_leaf_and_type(self):
        def mutations(value, path=()):
            if type(value) is dict:
                for name, item in value.items():
                    yield from mutations(item, path + (name,))
            elif type(value) is list:
                for i, item in enumerate(value):
                    yield from mutations(item, path + (i,))
            else:
                yield path, value
        for path, old in mutations(checker.FROZEN):
            for replacement in (None, True, False, 0, 1, 1.0, 'changed', [], {}):
                if type(old) is type(replacement) and old == replacement:
                    continue
                with self.subTest(path=path, replacement=replacement):
                    changed = copy.deepcopy(self.design)
                    target = changed
                    for key in path[:-1]:
                        target = target[key]
                    target[path[-1]] = replacement
                    self.reject(changed)

    def test_missing_extra_keys_at_all_object_levels(self):
        for path in ((), ('selector',), ('arms', 0), ('arms', 2), ('cells', 0)):
            for mode in ('missing', 'extra'):
                changed = copy.deepcopy(self.design)
                target = changed
                for key in path:
                    target = target[key]
                if mode == 'missing':
                    target.pop(next(iter(target)))
                else:
                    target['unexpected'] = None
                self.reject(changed)

    def test_cell_mutations(self):
        for mode in ('missing', 'extra', 'duplicate', 'unknown', 'boolean', 'float', 'unhashable'):
            with self.subTest(mode=mode):
                changed = copy.deepcopy(self.design)
                cells = changed['cells']
                if mode == 'missing': cells.pop()
                if mode == 'extra': cells.append(cells[0])
                if mode == 'duplicate': cells[-1] = cells[0]
                if mode == 'unknown': cells[0]['problem'] = 'unknown'
                if mode == 'boolean': cells[0]['rep'] = False
                if mode == 'float': cells[0]['rep'] = 0.0
                if mode == 'unhashable': cells[0]['problem'] = []
                self.reject(changed)

    def test_malformed_containers(self):
        for value in (None, [], True, 1, ''):
            self.reject(value)
        for field in ('cells', 'arms', 'selector', 'fixedAcrossArms'):
            for value in (None, {}, [], True, ''):
                changed = copy.deepcopy(self.design)
                changed[field] = value
                self.reject(changed)

    def test_strict_json_and_bounds(self):
        for data in (b'{', b'\xff', b'{"x":1,"x":2}', b'{"x":NaN}', b'Infinity', b'1e999', b'-1e999',
                     b'{"x":[1e999]}',
                     b'[' * 1500 + b']' * 1500, b' ' * (checker.MAX_BYTES + 1)):
            with self.subTest(data=data[:25]), self.assertRaises(checker.DesignError):
                checker.parse(data)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'oversize'
            path.write_bytes(b' ' * (checker.MAX_BYTES + 1))
            for source in (path, Path(folder), Path(folder) / 'missing'):
                with self.assertRaises(checker.DesignError): checker.read_bounded(source)

    def manifest(self):
        return {'schemaVersion': 1, 'reportedTasks': list(checker.TASKS), 'repetitions': 1,
                'jobs': copy.deepcopy(self.design['cells']), 'modelCallsMade': 0,
                'taskFingerprints': {task: {field: '0' * 64 for field in
                    ('metadata', 'prompt', 'workspace', 'checks')} for task in checker.TASKS}}

    def test_manifest_schema(self):
        checker.check_manifest(self.manifest())
        for mode in ('missing', 'extra', 'duplicate', 'bool', 'tasks', 'fingerprint'):
            manifest = self.manifest()
            if mode == 'missing': manifest['jobs'].pop()
            if mode == 'extra': manifest['jobs'].append(manifest['jobs'][0])
            if mode == 'duplicate': manifest['jobs'][-1] = manifest['jobs'][0]
            if mode == 'bool': manifest['modelCallsMade'] = False
            if mode == 'tasks': manifest['reportedTasks'].pop()
            if mode == 'fingerprint': manifest['taskFingerprints'][checker.TASKS[0]]['checks'] = 'bad'
            with self.subTest(mode=mode), self.assertRaises(checker.DesignError):
                checker.check_manifest(manifest)

    def test_missing_changed_manifest_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as folder, tempfile.TemporaryDirectory() as outside:
            root = Path(folder)
            with self.assertRaises(checker.DesignError): checker.check(self.design, root)
            path = root / checker.FROZEN['fixtureManifestPath']
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps(self.manifest()))
            with self.assertRaises(checker.DesignError): checker.check(self.design, root)
            external = Path(outside) / 'manifest.json'
            external.write_bytes(path.read_bytes())
            path.unlink()
            path.symlink_to(external)
            with self.assertRaises(checker.DesignError): checker.check(self.design, root)

    def test_no_read_on_unfrozen_path_or_hash(self):
        for field, values in (('fixtureManifestPath', ('../escape', '/tmp/manifest', 'docs/../escape')),
                              ('fixtureManifestSHA256', ('0' * 64,)),
                              ('fixtureSource', ('0' * 40,)), ('runtimeBase', ('0' * 40,))):
            for value in values:
                changed = copy.deepcopy(self.design)
                changed[field] = value
                with patch.object(checker, 'read_bounded') as read:
                    with self.assertRaises(checker.DesignError): checker.check(changed, '/tmp')
                    read.assert_not_called()

    def test_optimized_subprocess_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'design.json'
            for mode in ('valid', 'missing-cell-wrong-model', 'duplicate-key', 'boolean', 'malformed', 'overflow', 'negative-overflow'):
                changed = copy.deepcopy(self.design)
                if mode == 'missing-cell-wrong-model':
                    changed['cells'].pop()
                    changed['arms'][2]['requestedModel'] = 'wrong/model'
                if mode == 'boolean': changed['repetitions'] = True
                data = json.dumps(changed)
                if mode == 'duplicate-key': data = data.replace('"version": 1', '"version": 1,"version": 1')
                if mode == 'malformed': data = '{'
                if mode == 'overflow': data = data.replace('"version": 1', '"version": 1e999')
                if mode == 'negative-overflow': data = '-1e999'
                path.write_text(data)
                result = subprocess.run([sys.executable, '-O', str(Path(checker.__file__)),
                    '--design', str(path)], capture_output=True, text=True, timeout=10)
                with self.subTest(mode=mode):
                    self.assertEqual(result.returncode, 0 if mode == 'valid' else 1)
                    output = json.loads(result.stdout if mode == 'valid' else result.stderr)
                    self.assertEqual(output['designValid'], mode == 'valid')
                    self.assertIs(output['campaignReady'], False)
                    self.assertIs(output['readyForLiveCalls'], False)
                    self.assertNotIn('Traceback', result.stderr)


if __name__ == '__main__':
    unittest.main()
