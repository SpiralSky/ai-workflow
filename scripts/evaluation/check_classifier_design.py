#!/usr/bin/env python3
"""Offline frozen draft-contract checks; never dispatch or authorize a campaign."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
DESIGN = ROOT / 'docs/evaluation/classifier-comparison-design.json'
MAX_BYTES = 65536
TASKS = ('02-inventory-feature', '05-report-refactor', '07-async-race',
         '08-api-mismatch', '09-cache-invalidation', 'L1-rename-sku',
         'L2-split-pricing', 'L3-import-cycle', 'L4-currency-param', 'L5-refund-double-count')
# Deliberately independent of the input file: changing a frozen draft requires review.
FROZEN = {'version': 1,
 'kind': 'draft-comparison-design',
 'readyForLiveCalls': False,
 'runtimeBase': '9ed722f2b333a881ae9f3486765dc66ff6042631',
 'fixtureSource': 'b1190e39d7568040960754d96f325b0edd0f4224',
 'fixtureManifestPath': 'docs/audits/evidence/2026-11-01-fulfil-matrix.json',
 'fixtureManifestSHA256': '42f45757faf59150bdc2cf3dae5fb8b79088c3677e7cda768c9c540803273bab',
 'repetitions': 1,
 'arms': [{'id': 'llm', 'reranker': 'llm'},
          {'id': 'none', 'reranker': 'none'},
          {'id': 'jev114', 'reranker': 'classifier', 'requestedModel': 'typesafe/jev-1.14'},
          {'id': 'microsoft-decision-1',
           'reranker': 'classifier',
           'requestedModel': 'microsoft/microsoft-decision-1'},
          {'id': 'perplexity-flash',
           'reranker': 'classifier',
           'requestedModel': 'perplexity/pplx-decider-flash-v1.2'}],
 'selector': {'retrievalK': 20,
              'shortlistN': 6,
              'completion': 'existing one-level requires, same catalog and exclusions',
              'threshold': None,
              'thresholdStatus': 'choose on separate development examples, freeze before target '
                                 'observations',
              'policy': 'noul-v1'},
 'fixedAcrossArms': ['main/secondary models, returned identities and provider routes',
                     'source/artifact/prompt/catalog/task/check/image hashes',
                     'branch settings, tool permissions, cache policy',
                     'limits/timeouts, seeds/repetitions and run ordering policy',
                     'retrieval inputs/order/K, shortlistN and completion semantics',
                     'grading tests, quality rubric, task acceptance and failure protocol'],
 'results': None}
EXPECTED = {(task, mode, tier, 0) for task in TASKS
            for mode in ('baseline', 'branch-only', 'orchestrate') for tier in ('S', 'L')}


class DesignError(ValueError):
    """A bounded, malformed, or unfrozen input failed offline validation."""


def require(condition, message):
    """Raise explicitly, including when Python optimizations disable assertions."""
    if not condition:
        raise DesignError(message)


def exact(value, expected, label):
    """Compare bounded schema and values without Python bool/int coercion."""
    require(type(value) is type(expected), label + ': wrong type')
    if type(expected) is dict:
        require(value.keys() == expected.keys(), label + ': wrong keys')
        for name, item in expected.items():
            exact(value[name], item, label + '.' + name)
    elif type(expected) is list:
        require(len(value) == len(expected), label + ': wrong length')
        for i, item in enumerate(expected):
            exact(value[i], item, label + '[' + str(i) + ']')
    else:
        require(value == expected, label + ': frozen value changed')


def cells(value, label):
    """Require exactly one of each frozen cell, independently of array order."""
    require(type(value) is list and len(value) == 60, label + ': expected 60 cells')
    found = set()
    for cell in value:
        require(type(cell) is dict and cell.keys() == {'problem', 'framework', 'tier', 'rep'},
                label + ': wrong cell keys/type')
        require(all(type(cell[k]) is str for k in ('problem', 'framework', 'tier'))
                and type(cell['rep']) is int, label + ': wrong cell field type')
        item = tuple(cell[k] for k in ('problem', 'framework', 'tier', 'rep'))
        require(item in EXPECTED and item not in found, label + ': unknown or duplicate cell')
        found.add(item)
    require(found == EXPECTED, label + ': missing cells')


def object_pairs(pairs):
    """Reject duplicate JSON keys instead of accepting last-value-wins parsing."""
    result = {}
    for name, value in pairs:
        require(name not in result, 'JSON: duplicate key')
        result[name] = value
    return result


def parse(data):
    """Parse bounded strict UTF-8 JSON; normalize parser/type/depth failures."""
    require(type(data) is bytes and len(data) <= MAX_BYTES, 'JSON: wrong type or size limit')
    def invalid_constant(_):
        raise DesignError('JSON: nonfinite number')
    try:
        value = json.loads(data.decode('utf-8'), object_pairs_hook=object_pairs,
                           parse_constant=invalid_constant)
        pending = [(value, 0)]
        while pending:
            item, depth = pending.pop()
            require(depth <= 16, 'JSON: depth limit')
            if type(item) is float:
                require(math.isfinite(item), 'JSON: nonfinite number')
            if type(item) is dict:
                pending.extend((child, depth + 1) for child in item.values())
            elif type(item) is list:
                pending.extend((child, depth + 1) for child in item)
        return value
    except (ValueError, RecursionError) as error:
        raise DesignError('JSON: malformed input') from error


def read_bounded(path):
    """Read at most the cap plus one byte; reject nonregular files without blocking."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source:
            require(stat.S_ISREG(os.fstat(source.fileno()).st_mode), 'input: not a regular file')
            data = source.read(MAX_BYTES + 1)
        require(len(data) <= MAX_BYTES, 'input: size limit')
        return data
    except (OSError, ValueError) as error:
        raise DesignError('input: unavailable, nonregular, or oversized') from error


def check_manifest(manifest):
    """Validate manifest shape/cells; digest verification separately pins all fingerprints."""
    require(type(manifest) is dict and manifest.keys() == {
        'schemaVersion', 'reportedTasks', 'repetitions', 'jobs', 'modelCallsMade',
        'taskFingerprints'}, 'manifest: wrong keys/type')
    for field, value in (('schemaVersion', 1), ('reportedTasks', list(TASKS)),
                         ('repetitions', 1), ('modelCallsMade', 0)):
        exact(manifest[field], value, 'manifest.' + field)
    cells(manifest['jobs'], 'manifest.jobs')
    fingerprints = manifest['taskFingerprints']
    require(type(fingerprints) is dict and fingerprints.keys() == set(TASKS),
            'manifest: wrong fingerprint tasks')
    for record in fingerprints.values():
        require(type(record) is dict and record.keys() == {'metadata', 'prompt', 'workspace', 'checks'},
                'manifest: wrong fingerprint fields')
        for digest in record.values():
            require(type(digest) is str and len(digest) == 64
                    and all(c in '0123456789abcdef' for c in digest), 'manifest: invalid fingerprint')


def check(design, fixture_root=None):
    """Validate only this frozen draft; optional manifest verification is not fixture execution."""
    require(type(design) is dict and design.keys() == FROZEN.keys() | {'cells'},
            'design: wrong keys/type')
    for name, value in FROZEN.items():
        exact(design[name], value, 'design.' + name)
    cells(design['cells'], 'design.cells')
    fixture_verified = False
    if fixture_root is not None:
        try:
            root = Path(fixture_root).resolve(strict=True)
            source = (root / FROZEN['fixtureManifestPath']).resolve(strict=True)
            require(root.is_dir() and source.is_relative_to(root), 'manifest: outside fixture root')
            data = read_bounded(source)
        except (OSError, ValueError, TypeError, RuntimeError) as error:
            raise DesignError('manifest: unavailable or outside fixture root') from error
        require(hashlib.sha256(data).hexdigest() == FROZEN['fixtureManifestSHA256'],
                'manifest: frozen digest changed')
        check_manifest(parse(data))
        fixture_verified = True
    return {'designValid': True, 'targetCellsPerArm': 60, 'arms': 5,
            'potentialCellsAtOneRepetition': 300, 'fixtureManifestVerified': fixture_verified,
            'liveCalls': 0, 'modelQualityMeasured': False, 'planApproved': False,
            'campaignReady': False, 'readyForLiveCalls': False}


def main():
    """Return machine-readable failure and nonzero status for invalid offline input."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--design', type=Path, default=DESIGN)
    parser.add_argument('--fixture-root', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.discover(str(Path(__file__).parent),
                                                    pattern='test_classifier_design.py')
        if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():
            return 1
    try:
        result = check(parse(read_bounded(args.design)), args.fixture_root)
    except DesignError as error:
        print(json.dumps({'designValid': False, 'error': str(error), 'liveCalls': 0,
                          'campaignReady': False, 'readyForLiveCalls': False}), file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
