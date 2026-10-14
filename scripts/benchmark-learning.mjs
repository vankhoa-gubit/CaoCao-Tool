import assert from 'node:assert/strict';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { JobManager } from '../src/jobs.mjs';
import { DatasetService } from '../src/datasets.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url))), pageSize = 1000;
const mb = bytes => Number((bytes / 1024 / 1024).toFixed(2));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sessions = { async closeAll() {} };
async function measure(action) {
  let rss = 0, heap = 0;
  const sample = () => { const value = process.memoryUsage();rss = Math.max(rss, value.rss);heap = Math.max(heap, value.heapUsed); };
  sample();const timer = setInterval(sample, 20), start = performance.now();
  try { const value = await action();sample();return { value, elapsedMs: Number((performance.now() - start).toFixed(2)), sampledPeakRssMB: mb(rss), sampledPeakHeapMB: mb(heap) }; }
  finally { clearInterval(timer); }
}
function stats(measurement) { const { value, ...result } = measurement;return result; }
const pagePath = (job, number) => join(job.directory, 'pages', String(number).padStart(8, '0') + '.json');
if (process.argv[2] === '--worker') {
  const [directory, url, rawCount, baselineDirectory, baselineId] = process.argv.slice(3), count = Number(rawCount);
  let manager = await new JobManager(join(directory, 'jobs'), sessions).init(), baseline;
  try {
    const job = await manager.create({ name: `${count} record benchmark`, sourceId: 'learning-benchmark', request: { url }, extract: { itemsPath: 'items', uniqueKey: 'id' }, pagination: { mode: 'page', param: 'page', pageSize, sizeParam: 'limit', hasMorePath: 'more', totalPath: 'total' }, limits: { delayMs: 0, maxItems: count / 2, maxRequests: 10000 }, saveRaw: true });
    const first = await measure(async () => { job.start();await job.promise; });
    assert.equal(job.status, 'limited');assert.equal(job.progress.items, count / 2);
    const originalPages = new Map();for(let i = 1; i <= job.progress.pages; i++)originalPages.set(i, digest(await readFile(pagePath(job, i))));
    const id = job.id;await manager.close();global.gc?.();
    const restart = await measure(async () => { manager = await new JobManager(join(directory, 'jobs'), sessions).init(); });
    const recovered = manager.get(id);assert.equal(recovered.progress.items, count / 2);assert.equal(recovered.keys.size, 0);
    const resume = await measure(async () => { recovered.start();await recovered.promise; });
    assert.equal(recovered.status, 'completed');assert.equal(recovered.progress.items, count);assert.equal(recovered.keys.size, 0);
    const verification = await measure(async () => { let expected = 0;for await(const record of recovered.records())assert.equal(record.id, expected++);assert.equal(expected, count);for(const [number, before] of originalPages)assert.equal(digest(await readFile(pagePath(recovered, number))), before);return expected; });
    const datasets = new DatasetService(manager);
    const columns=['id','title','body'];
    const cold = await measure(() => datasets.browse(id, { limit: 25,columns }));assert.equal(cold.value.pagination.total, count);assert.equal(cold.value.rows[0].values[0], 0);
    const warm = await measure(() => datasets.browse(id, { page: Math.ceil(count / 25), limit: 25,columns }));assert.equal(warm.value.rows.at(-1).values[0], count - 1);
    const search = await measure(() => datasets.browse(id, { search: `Bài học ${count - 1}`, limit: 25,columns }));assert.equal(search.value.pagination.total, 1);assert.equal(search.value.rows[0].values[0], count - 1);
    let comparison;
    if (baselineDirectory && baselineId) {
      baseline = await new JobManager(baselineDirectory, sessions).init();const base = baseline.get(baselineId);manager.jobs.set(base.id, base);
      const diff = await measure(() => datasets.compare(id, base.id, { limit: 25 }));
      assert.deepEqual(diff.value.counts, { added: count - base.progress.items, changed: base.progress.items / 1000, missing: 0, unchanged: base.progress.items - base.progress.items / 1000 });
      const changed = await datasets.compare(id, base.id, { type: 'changed', limit: 25 });assert.equal(changed.rows[0].key, 0);assert.equal(changed.pagination.total, 100);
      comparison = { ...stats(diff), counts: diff.value.counts, baselineRecords: base.progress.items };
    }
    const report = { records: count, pageSize, jobId: id, jobsDirectory: manager.directory, pages: recovered.progress.pages, firstHalf: stats(first), restart: { ...stats(restart), restoreSource: recovered.restoreSource }, secondHalf: stats(resume), verification: { ...stats(verification), idsInOrder: verification.value, originalPagesUnchanged: originalPages.size, retainedKeys: recovered.keys.size }, browseCold: stats(cold), browseWarmLastPage: stats(warm), search: stats(search), ...(comparison ? { comparison } : {}) };
    await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));console.log(JSON.stringify(report));
  } finally { await manager.close();await baseline?.close(); }
} else {
  await mkdir(join(root, '.qa'), { recursive: true });const directory = await mkdtemp(join(root, '.qa', 'learning-benchmark-'));
  const counters = new Map(), requested = new Map();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), count = Number(url.searchParams.get('count')), page = Number(url.searchParams.get('page') || 1), offset = (page - 1) * pageSize;
    const items = Array.from({ length: Math.min(pageSize, count - offset) }, (_, index) => { const id = offset + index;return { id, title: 'Bài học ' + id, body: 'Dữ liệu học tập dùng để kiểm chứng bộ nhớ và phục hồi. '.repeat(4) + (count > 100000 && id % 1000 === 0 ? 'Updated' : ''), question: 'Câu hỏi ' + id, answer: 'Đáp án ' + id, category: id % 10 }; });
    const body = JSON.stringify({ items, more: offset + pageSize < count, total: count }), bytes = Buffer.byteLength(body), previous = counters.get(count) || { requests: 0, bodyBytes: 0 };
    previous.requests++;previous.bodyBytes += bytes;counters.set(count, previous);const seen = requested.get(count) || [];seen.push(page);requested.set(count, seen);
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': bytes });response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = { node: process.version, platform: process.platform, directory, method: 'Independent Node worker per size; real local HTTP; raw responses enabled; 1,000 records/page; crawl half, restart, resume; ordered ID verification with no full-data Set. RSS/heap sampled every 20 ms and at phase boundaries. OS file cache is not cleared. Source fixture runs in the parent, outside the measured worker.', results: [] };
  try {
    for (const count of [100000, 1000000]) {
      const output = join(directory, String(count));await mkdir(output);const base = report.results[0];
      const args = ['--worker', output, `http://127.0.0.1:${server.address().port}/records?count=${count}`, String(count), ...(base ? [base.jobsDirectory, base.jobId] : [])];
      const child = fork(fileURLToPath(import.meta.url), args, { execArgv: ['--expose-gc'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
      const [code] = await once(child, 'exit');assert.equal(code, 0, 'Benchmark worker failed');const result = JSON.parse(await readFile(join(output, 'result.json'), 'utf8'));
      assert.deepEqual(requested.get(count), Array.from({ length: count / pageSize }, (_, i) => i + 1));result.network = { ...counters.get(count), repeatedCommittedPages: 0 };report.results.push(result);
      await writeFile(join(directory, 'result.json'), JSON.stringify(report, null, 2));console.log(`Verified ${count} records; evidence: ${join(output, 'result.json')}`);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
  console.log('Learning benchmark evidence: ' + join(directory, 'result.json'));
}
