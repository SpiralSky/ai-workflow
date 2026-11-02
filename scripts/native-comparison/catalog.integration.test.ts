import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, REVIEWED_CATALOG_ROOT, REVIEWED_SOURCE_TREE } from './catalog.ts';
import { experiment } from './method.ts';
import { TASKS } from './tasks.ts';
import { SYNTHETIC_SOLUTIONS } from './synthetic-solutions.test-data.ts';

/** Additional mandatory campaign gate, deliberately separate from portable framework unit gates. */
test('actual reviewed selector yields fixed AB/BA paired contracts without added tools', async () => {
  const catalog = await loadCatalog(REVIEWED_CATALOG_ROOT);
  assert.equal(catalog.kind, 'reviewed-local'); assert.equal(catalog.reviewedSourceTree, REVIEWED_SOURCE_TREE);
  const plan = await experiment(catalog);
  assert.deepEqual(plan.cells.map(c => c.arm), ['off', 'on', 'on', 'off']);
  assert.equal(plan.manifest.nativeAssignmentsMaximum, 4);
  for (const task of TASKS) {
    const off = plan.cells.find(c => c.taskId === task.id && c.arm === 'off')!;
    const on = plan.cells.find(c => c.taskId === task.id && c.arm === 'on')!;
    assert.deepEqual(off.snippets, []); assert.ok(on.snippets.length > 0);
    assert.equal(off.checksExpected, task.cases.length); assert.equal(on.checksExpected, task.cases.length);
    assert.equal(on.brief.slice(0, off.brief.length), off.brief);
    assert.ok(on.brief.includes(task.publicContract)); assert.ok(on.brief.includes(task.instruction));
    for (const id of on.snippets) {
      const s = catalog.snippets.find(s => s.id === id)!;
      assert.ok(on.brief.includes(s.code)); assert.ok(s.tools.every(name => task.toolNames.includes(name)));
    }
    assert.ok(!on.brief.includes(SYNTHETIC_SOLUTIONS[task.id]));
  }
});
