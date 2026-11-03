"""Explicit local fixture gate. Never runs actors or model calls."""
from pathlib import Path
import json, sys, unittest
suite=unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parent.parent/'experiments/native-dev'),pattern='test_fixtures.py')
result=unittest.TextTestRunner(stream=sys.stderr,verbosity=1).run(suite)
counts={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'expectedFailures':len(result.expectedFailures),'unexpectedSuccesses':len(result.unexpectedSuccesses)}
print(json.dumps({'kind':'fixture-controls','modelCalls':0,'counts':counts}))
sys.exit(0 if result.wasSuccessful() and counts['run'] and all(value==0 for key,value in counts.items() if key!='run') else 1)
