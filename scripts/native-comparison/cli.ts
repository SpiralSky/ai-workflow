import { experiment, gradeRun, prepareEngine, prepareRun, summarize, type EvidenceKind } from './method.ts';
import { loadCatalog } from './catalog.ts';

/** Manual local preparation/grading only. Nothing in this CLI launches a worker or a model. */
async function main() {
  const [command, id, cellOrRoot, rootOrKind, optionalKind, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('unexpected arguments');
  if (command === 'preflight' && id && !cellOrRoot) return {
    ...(await experiment(await loadCatalog(id))).manifest, infrastructurePreflight: await prepareEngine(),
  };
  if (command === 'prepare' && id && cellOrRoot && !rootOrKind) return prepareRun(id, cellOrRoot);
  if (command === 'summarize' && id && cellOrRoot && !rootOrKind) return summarize(id, cellOrRoot);
  if (command === 'grade' && id && cellOrRoot && rootOrKind) {
    const kind = optionalKind ?? 'synthetic-contract';
    if (!['synthetic-contract', 'coordinator-declared-dot-assisted'].includes(kind)) throw new Error('invalid evidence kind');
    const result = await gradeRun(id, cellOrRoot, rootOrKind, kind as EvidenceKind);
    if (!result.passed) process.exitCode = 1;
    return result;
  }
  throw new Error('Usage: preflight ABSOLUTE_REVIEWED_CATALOG_ROOT; prepare|summarize ID ABSOLUTE_REVIEWED_CATALOG_ROOT; grade ID CELL ABSOLUTE_REVIEWED_CATALOG_ROOT [synthetic-contract|coordinator-declared-dot-assisted]');
}
main().then(value => console.log(JSON.stringify(value, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
