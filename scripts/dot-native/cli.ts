import { gradeRun, prepareRun } from './method.ts';

const [command, id, kind, ...extra] = process.argv.slice(2);
try {
  if (!id || extra.length) throw new Error('usage: cli.ts prepare ID | grade ID [synthetic-contract|coordinator-declared-dot-assisted]');
  if (command === 'prepare' && !kind) console.log(await prepareRun(id));
  else if (command === 'grade' && (!kind || kind === 'synthetic-contract' || kind === 'coordinator-declared-dot-assisted')) {
    const report = await gradeRun(id, kind === 'coordinator-declared-dot-assisted' ? 'coordinator-declared-dot-assisted' : 'synthetic-contract');
    console.log(JSON.stringify({ passed: report.passed, checksRun: report.checksRun, checksExpected: report.checksExpected,
      evidenceKind: report.evidenceKind, accounting: report.accounting }));
    if (!report.passed) process.exitCode = 1;
  } else throw new Error('invalid command or evidence kind');
} catch (error) {
  console.error((error as Error).message.slice(0, 500));
  process.exitCode = 1;
}
