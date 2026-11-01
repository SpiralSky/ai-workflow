#!/usr/bin/env python3
"""Offline draft-design invariants only; never dispatch providers or certify model quality."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / 'docs/evaluation/classifier-comparison-design.json'
TASKS = ('02-inventory-feature', '05-report-refactor', '07-async-race',
         '08-api-mismatch', '09-cache-invalidation', 'L1-rename-sku',
         'L2-split-pricing', 'L3-import-cycle', 'L4-currency-param', 'L5-refund-double-count')

def key(cell):
    return tuple(cell.get(k) for k in ('problem', 'framework', 'tier', 'rep'))

def check(design, fixture_root=None):
    """Require exact existing target dimensions and explicit absence of live results/authority."""
    assert design['version'] == 1 and design['kind'] == 'draft-comparison-design'
    assert design['readyForLiveCalls'] is False and design['results'] is None
    expected = {(task, mode, tier, 0) for task in TASKS
                for mode in ('baseline', 'branch-only', 'orchestrate') for tier in ('S', 'L')}
    actual = [key(c) for c in design['cells']]
    assert len(actual) == len(set(actual)) == 60 and set(actual) == expected
    assert design['repetitions'] == 1
    assert [arm['id'] for arm in design['arms']] == ['llm', 'none', 'jev114', 'microsoft-decision-1', 'perplexity-flash']
    assert [arm['reranker'] for arm in design['arms']] == ['llm', 'none', 'classifier', 'classifier', 'classifier']
    assert design['selector']['retrievalK'] == 20 and design['selector']['shortlistN'] == 6
    assert design['selector']['threshold'] is None, 'Freeze threshold in a reviewed later design revision, not silently here'
    fixture_verified = False
    if fixture_root is not None:
        source = Path(fixture_root) / design['fixtureManifestPath']
        data = source.read_bytes()
        assert hashlib.sha256(data).hexdigest() == design['fixtureManifestSHA256'], 'Frozen fixture manifest changed'
        assert {key(c) for c in json.loads(data)['jobs']} == expected
        fixture_verified = True
    return {'designValid': True, 'targetCellsPerArm': 60, 'arms': 5,
            'potentialCellsAtOneRepetition': 300, 'fixtureManifestVerified': fixture_verified,
            'liveCalls': 0, 'modelQualityMeasured': False, 'planApproved': False,
            'campaignReady': False}

class DesignChecks(unittest.TestCase):
    """Mutations demonstrate structural checks, not fabricated classifier outputs."""
    def setUp(self):
        self.design = json.loads(DESIGN.read_text())
    def test_exact_design(self):
        self.assertEqual(check(self.design)['targetCellsPerArm'], 60)
    def test_omitted_cell(self):
        self.design['cells'].pop()
        with self.assertRaises(AssertionError): check(self.design)
    def test_duplicate_cell(self):
        self.design['cells'][-1] = copy.deepcopy(self.design['cells'][0])
        with self.assertRaises(AssertionError): check(self.design)
    def test_weaker_shortlist(self):
        self.design['selector']['shortlistN'] = 3
        with self.assertRaises(AssertionError): check(self.design)
    def test_fabricated_results(self):
        self.design['results'] = {'savingsPercent': 90}
        with self.assertRaises(AssertionError): check(self.design)
    def test_unapproved_live_flag(self):
        self.design['readyForLiveCalls'] = True
        with self.assertRaises(AssertionError): check(self.design)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-root', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        outcome = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(DesignChecks))
        if not outcome.wasSuccessful(): raise SystemExit(1)
    print(json.dumps(check(json.loads(DESIGN.read_text()), args.fixture_root), indent=2))
