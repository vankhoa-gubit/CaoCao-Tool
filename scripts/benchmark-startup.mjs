import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { JobManager, atomicJson } from '../src/jobs.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sessions = { async closeAll() {} };
const hash = value => createHash('sha256').update(value).digest('hex');
const mb = value => Number((value / 1024 / 1024).toFixed(2));
if (process.argv[2] === '--measure') {
  const [, , , directory, mode, baseline] = process.argv;
  const Manager = mode === 'eager' ? (await import(pathToFileURL(baseline).href)).JobManager : JobManager;
  global.gc(); const before = process.memoryUsage(); const start = performance.now();
  const manager = await new Manager(directory, sessions, { restoreMode: mode === 'fallback' ? 'reconcile' : 'metadata' }).init();
  const startupMs = performance.now() - start;
  global.gc(); const after = process.memoryUsage();
  const result = { mode, startupMs: Number(startupMs.toFixed(2)), heapMB: mb(after.heapUsed), retainedHeapMB: mb(after.heapUsed - before.heapUsed), rssMB: mb(after.rss), retainedKeys: [...manager.jobs.values()].reduce((sum, job) => sum + job.keys.size, 0), items: [...manager.jobs.values()].reduce((sum, job) => sum + job.progress.items, 0), jobs: manager.jobs.size };
  await manager.close(); console.log(JSON.stringify(result));
} else {
  await mkdir(join(root, '.qa'), { recursive: true });
  const directory = await mkdtemp(join(root, '.qa', 'startup-benchmark-'));
  // The exact previous implementation is measured, not a new loop that simulates it.
  const baselineRef = process.argv.includes('--baseline') ? process.argv[process.argv.indexOf('--baseline') + 1] : 'c4e08c9addecdad11f6942d094a14dfe0199b2e9';
  const baselineRevision = execFileSync('git', ['rev-parse', baselineRef], { cwd: root, encoding: 'utf8' }).trim();
  const original = execFileSync('git', ['show', `${baselineRevision}:src/jobs.mjs`], { cwd: root, encoding: 'utf8' });
  const baseline = join(directory, 'baseline-jobs.mjs');
  await writeFile(baseline, original.replace(/from '(\.\/[^']+)'/g, (_, specifier) => `from '${pathToFileURL(resolve(root, 'src', specifier)).href}'`));
  const report = { node: process.version, baselineRevision, baselineMethod: 'Previous JobManager.init/Job.restore from Git, same fixtures, independent Node process per measurement', repetitions: 3, note: 'OS file cache was not cleared; heap measurements use --expose-gc. Raw-page hashes and all exported IDs are verified.', directory, results: [] };
  for (const count of [10000, 100000]) {
    const jobsDirectory = join(directory, String(count), 'jobs');
    const manager = await new JobManager(jobsDirectory, sessions).init();
    const pageDigests = new Map();
    for (let jobIndex = 0; jobIndex < 20; jobIndex++) {
      const job = await manager.create({ name: `Benchmark ${jobIndex}`, request: { url: 'http://127.0.0.1:1/benchmark' }, extract: { itemsPath: 'items', uniqueKey: 'id' }, pagination: { mode: 'offset', param: 'offset', totalPath: 'total' } });
      const length = count / 20;
      for (let offset = 0; offset < length; offset += 250) {
        const items = Array.from({ length: Math.min(250, length - offset) }, (_, index) => ({ id: jobIndex * length + offset + index, text: 'Dữ liệu benchmark. '.repeat(8), category: jobIndex }));
        const keys = items.map(item => hash(JSON.stringify(['id', item.id])));
        const index = offset / 250 + 1, more = offset + 250 < length;
        const page = { index, at: new Date().toISOString(), items, keys, files: [], duplicates: 0, position: { engine: 'api', page: offset }, nextState: more ? { value: offset + 250, batch: 1, nextUrl: null, rawCount: offset + items.length } : null, requestHash: hash(job.id + ':' + offset), responseHash: hash(JSON.stringify(items)), response: { items, total: length, more } };
        const path = join(job.directory, 'pages', `${String(index).padStart(8, '0')}.json`);
        await atomicJson(path, page); pageDigests.set(path, hash(await readFile(path)));
        job.samples = items.slice(-3);
      }
      Object.assign(job.progress, { items: length, pages: Math.ceil(length / 250), requests: Math.ceil(length / 250), total: length });
      job.status = 'completed'; job.state = null; await job.persist();
    }
    await manager.close();
    const measurements = [];
    for (let round = 0; round < 3; round++) for (const mode of round % 2 ? ['fallback', 'metadata', 'eager'] : ['eager', 'metadata', 'fallback']) {
      const result = JSON.parse(execFileSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--measure', jobsDirectory, mode, baseline], { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }));
      assert.equal(result.items, count); assert.equal(result.jobs, 20);
      assert.equal(result.retainedKeys, mode === 'eager' ? count : 0); measurements.push({ round: round + 1, ...result });
    }
    const recovered = await new JobManager(jobsDirectory, sessions).init();
    const ids = new Set();
    for (const job of recovered.jobs.values()) {
      const exported = JSON.parse(await readFile(await job.export('json'), 'utf8'));
      for (const record of exported) { assert.ok(!ids.has(record.id)); ids.add(record.id); }
    }
    assert.equal(ids.size, count);
    for (let id = 0; id < count; id++) assert.ok(ids.has(id));
    for (const [path, before] of pageDigests) assert.equal(hash(await readFile(path)), before);
    const fullBytes = Buffer.byteLength(JSON.stringify({ jobs: recovered.list() }));
    const pagedBytes = Buffer.byteLength(JSON.stringify(recovered.list({ page: 1, limit: 15 })));
    const detailBytes = Buffer.byteLength(JSON.stringify(recovered.list()[0]));
    await recovered.close();
    const median = (mode, field) => measurements.filter(result => result.mode === mode).map(result => result[field]).sort((a, b) => a - b)[1];
    report.results.push({ records: count, jobs: 20, pages: pageDigests.size, measurements, median: Object.fromEntries(['eager', 'metadata', 'fallback'].map(mode => [mode, { startupMs: median(mode, 'startupMs'), retainedHeapMB: median(mode, 'retainedHeapMB'), rssMB: median(mode, 'rssMB') }])), payload: { fullBytes, pagedBytes, detailBytes }, verification: { exportedIds: ids.size, rawPagesUnchanged: pageDigests.size } });
    console.log(`${count} records: eager ${median('eager', 'startupMs')} ms / ${median('eager', 'retainedHeapMB')} MB; metadata ${median('metadata', 'startupMs')} ms / ${median('metadata', 'retainedHeapMB')} MB; fallback ${median('fallback', 'startupMs')} ms / ${median('fallback', 'retainedHeapMB')} MB`);
  }
  await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));
  console.log('Benchmark evidence: ' + join(directory, 'result.json'));
}
