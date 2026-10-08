import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { JobManager } from '../src/jobs.mjs';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { normalizeConfig } from '../src/config.mjs';
import { catalog, msg, formatMessage, MessageError } from '../public/messages.js';

const sessions = () => ({ async closeAll() {} });
async function fixture(t) {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  const directory = await mkdtemp(join(projectRoot, '.qa', 'optimizations-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost'); requests.push(url.pathname + url.search);
    if (url.pathname === '/slow') await new Promise(resolve => setTimeout(resolve, 500));
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/bad') { res.end(JSON.stringify({ wrong: [] })); return; }
    const page = Number(url.searchParams.get('page') || 1);
    res.end(JSON.stringify({ items: page === 1 ? [{ id: 1, text: 'Nguồn tiếng Việt' }, { id: 2 }] : [{ id: 2 }, { id: 3 }], more: page < 2, total: 3 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const manager = await new JobManager(join(directory, 'jobs'), sessions()).init();
  t.after(async () => { await manager.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const config = (path = '/slow', extra = {}) => ({ name: 'Kiểm tra', request: { url: origin + path }, extract: { itemsPath: 'items', uniqueKey: 'id' }, pagination: { mode: 'page', param: 'page', hasMorePath: 'more', totalPath: 'total' }, limits: { delayMs: 0, retries: 0 }, ...extra });
  return { directory, manager, config, requests };
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const digest = async path => createHash('sha256').update(await readFile(path)).digest('hex');

test('Admission reserves slots before asynchronous creation and rejects concurrent overflow', async t => {
  const { manager, config } = await fixture(t);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => manager.createAndStart(config())));
  const accepted = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.equal(accepted.length, 2); assert.equal(manager.jobs.size, 2); assert.equal(manager.slots.size, 2);
  for (const rejected of results.filter(result => result.status === 'rejected')) assert.deepEqual(rejected.reason.messageData, msg('job.capacity', { limit: 2 }));
  await Promise.all(accepted.map(job => job.pause())); assert.equal(manager.slots.size, 0);
});

test('Resume and direct start share admission; a paused slot can be reused', async t => {
  const { manager, config } = await fixture(t);
  const archived = await manager.create(config());
  const jobs = await Promise.all([manager.createAndStart(config()), manager.createAndStart(config())]);
  assert.throws(() => archived.start(), error => error.messageData.code === 'job.capacity');
  assert.equal(archived.status, 'paused'); assert.equal(archived.promise, null);
  assert.throws(() => jobs[0].start(), error => error.messageData.code === 'job.running');
  await jobs[0].pause(); archived.start(); assert.equal(manager.slots.size, 2);
  await archived.pause(); await jobs[1].pause(); assert.equal(manager.slots.size, 0);
});

test('Validation, failed start, completion and checkpoint failure release slots', async t => {
  const { manager, config } = await fixture(t);
  await assert.rejects(manager.createAndStart({}), error => error.messageData.code === 'url.invalid');
  assert.equal(manager.slots.size, 0);
  const good = await manager.createAndStart(config('/fast')); await good.promise;
  assert.equal(good.status, 'completed'); assert.equal(manager.slots.size, 0);
  const bad = await manager.createAndStart(config('/bad')); await bad.promise;
  assert.equal(bad.status, 'failed'); assert.equal(bad.errorMessage.code, 'record.array'); assert.equal(manager.slots.size, 0);
  const disk = await manager.create(config('/fast'));
  disk.persist = async () => { throw new Error('QA disk error'); };
  disk.start(); await disk.promise;
  assert.equal(disk.status, 'failed'); assert.equal(disk.errorMessage.code, 'checkpoint.failed'); assert.equal(manager.slots.size, 0);
});

test('Shutdown waits for pending creation, rejects new starts and leaks no reservation', async t => {
  const { manager, config } = await fixture(t);
  const createJob = manager.createJob.bind(manager);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  manager.createJob = async input => { entered(); await gate; return createJob(input); };
  const creating = manager.createAndStart(config());
  await ready;
  const shutdown = manager.close();
  await assert.rejects(manager.createAndStart(config()), error => error.messageData.code === 'manager.closed');
  release(); await assert.rejects(creating, error => error.messageData.code === 'manager.closed');
  await shutdown; assert.equal(manager.slots.size, 0); assert.equal(manager.pending.size, 0);
});

test('HTTP create and resume obey the same limit and report structured errors', async t => {
  const { directory, config } = await fixture(t);
  const app = await createApp({ dataDirectory: join(directory, 'api'), sessions: sessions() });
  const origin = await listen(app, 0); t.after(() => app.close());
  const paused = await app.manager.create(config());
  const post = path => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(path === '/api/jobs' ? { config: config() } : {}) });
  const responses = await Promise.all(Array.from({ length: 4 }, () => post('/api/jobs')));
  assert.equal(responses.filter(response => response.status === 201).length, 2);
  assert.equal(responses.filter(response => response.status === 409).length, 2);
  const history = await fetch(origin + '/api/jobs?page=1&limit=1&status=running').then(response => response.json());
  assert.equal(history.pagination.total, 2); assert.equal(history.jobs.length, 1); assert.equal(history.activity.running, 2);
  assert.ok(!('logs' in history.jobs[0]));
  assert.ok('logs' in await fetch(origin + '/api/jobs/' + history.jobs[0].id).then(response => response.json()));
  assert.equal((await fetch(origin + '/api/jobs').then(response => response.json())).jobs.length, 3);
  assert.equal((await fetch(origin + '/api/jobs?page=0')).status, 400);
  const denied = await post('/api/jobs/' + paused.id + '/resume');
  assert.equal(denied.status, 409); assert.deepEqual((await denied.json()).errorMessage, msg('job.capacity', { limit: 2 }));
  const job = [...app.manager.jobs.values()].find(job => job.promise); await job.pause();
  assert.equal((await post('/api/jobs/' + paused.id + '/resume')).status, 200);
});

test('History has stable pagination, name/ID search, status filters and bounded lightweight summaries', async t => {
  const { manager, config } = await fixture(t);
  for (let i = 0; i < 37; i++) {
    const job = await manager.create(config('/fast', { name: `Nghiên cứu ${String(i).padStart(2, '0')}` }));
    job.createdAt = new Date(1700000000000 + i).toISOString();
    job.status = i % 2 ? 'completed' : 'paused'; job.logs = [{ message: 'x'.repeat(30000) }]; job.samples = [{ text: 'x'.repeat(30000) }];
  }
  const pages = [1, 2, 3].map(page => manager.list({ page, limit: 15 }));
  assert.deepEqual(pages.map(result => result.jobs.length), [15, 15, 7]);
  assert.equal(new Set(pages.flatMap(result => result.jobs.map(job => job.id))).size, 37);
  assert.equal(pages[0].jobs[0].name, 'Nghiên cứu 36');
  assert.ok(pages.every(result => result.jobs.every(job => !('logs' in job) && !('samples' in job) && !('outputPath' in job))));
  assert.equal(manager.list({ search: 'NGHIÊN CỨU 03' }).jobs[0].name, 'Nghiên cứu 03');
  assert.equal(manager.list({ search: pages[0].jobs[0].id }).pagination.total, 1);
  assert.equal(manager.list({ status: 'completed' }).pagination.total, 18);
  assert.equal(manager.list({ search: 'absent', page: 5 }).pagination.page, 1);
  assert.equal(manager.list({ page: 999 }).pagination.page, 3);
  for (const options of [{ page: 0 }, { limit: 101 }, { status: 'bad' }, { page: 'Infinity' }]) assert.throws(() => manager.list(options), MessageError);
  assert.equal(manager.list()[0].logs[0].message.length, 30000);
});

test('Metadata startup keeps archived keys empty, then lazy resume preserves IDs and raw pages', async t => {
  const { manager, config } = await fixture(t);
  const job = await manager.createAndStart(config('/fast', { limits: { maxRequests: 1, delayMs: 0, retries: 0 } })); await job.promise;
  const originalPage = join(job.directory, 'pages', '00000001.json'), before = await digest(originalPage);
  const recovered = await new JobManager(manager.directory, sessions()).init(); t.after(() => recovered.close());
  const resume = recovered.get(job.id);
  assert.equal(resume.restoreSource, 'metadata'); assert.equal(resume.keys.size, 0); assert.equal(resume.keysLoaded, false);
  assert.equal(resume.samples[0].text, 'Nguồn tiếng Việt');
  resume.start(); await resume.promise;
  assert.equal(resume.status, 'completed'); assert.equal(resume.progress.duplicates, 1);
  assert.deepEqual((await readJson(await resume.export('json'))).map(record => record.id), [1, 2, 3]);
  assert.equal(await digest(originalPage), before); assert.equal(resume.keys.size, 0); assert.equal(resume.requestHashes.size, 0);
});

test('Corrupt, absent and stale checkpoints reconcile committed pages and refresh metadata', async t => {
  const { manager, config } = await fixture(t);
  const job = await manager.createAndStart(config('/fast', { limits: { maxRequests: 1, delayMs: 0, retries: 0 } })); await job.promise;
  const checkpoint = join(job.directory, 'checkpoint.json'); const original = await readJson(checkpoint);
  for (const change of ['tampered', 'invalid', 'missing', 'legacy', 'stale']) {
    if (change === 'missing') await rm(checkpoint);
    else if (change === 'invalid') await writeFile(checkpoint, '{bad');
    else {
      const snapshot = structuredClone(original);
      if (change === 'tampered') { snapshot.progress.items = 9999; snapshot.state.value = 99; }
      if (change === 'legacy') { delete snapshot.formatVersion; delete snapshot.metadataHash; }
      if (change === 'stale') { snapshot.checkpointPage = 0; snapshot.progress.pages = 0; snapshot.state.value = 1; }
      await writeFile(checkpoint, JSON.stringify(snapshot));
    }
    const recovery = await new JobManager(manager.directory, sessions()).init();
    const saved = recovery.get(job.id);
    assert.equal(saved.restoreSource, 'pages', change); assert.equal(saved.progress.items, 2, change);
    // A tampered state with the same page count must also use committed nextState.
    assert.equal(saved.state.value, 2, change);
    assert.equal(saved.keys.size, 0); assert.equal((await readJson(checkpoint)).formatVersion, 2);
    await recovery.close();
  }
});

test('Missing committed page and config changes invalidate cached metadata', async t => {
  const { manager, config } = await fixture(t);
  const job = await manager.createAndStart(config('/fast')); await job.promise;
  const second = join(job.directory, 'pages', '00000002.json'); await rename(second, second + '.qa');
  const recovery = await new JobManager(manager.directory, sessions()).init();
  assert.equal(recovery.get(job.id).restoreSource, 'pages'); assert.equal(recovery.get(job.id).progress.items, 2); await recovery.close();
  const configPath = join(job.directory, 'config.json'), stored = await readJson(configPath); stored.name = 'Đổi tên'; await writeFile(configPath, JSON.stringify(stored));
  const renamed = await new JobManager(manager.directory, sessions()).init();
  assert.equal(renamed.get(job.id).restoreSource, 'pages'); assert.equal(renamed.get(job.id).config.name, 'Đổi tên'); await renamed.close();
});

test('New descriptors translate independently of legacy sentences and preserve literal parameters', async () => {
  assert.throws(() => normalizeConfig({ request: { url: 'http://localhost' }, limits: { delayMs: -1 } }), error => {
    assert.deepEqual(error.messageData, msg('config.integer', { label: msg('label.delay'), min: 0, max: 60000 }));
    assert.equal(formatMessage(error.messageData, 'en'), 'Delay must be an integer from 0 to 60000.'); return true;
  });
  const descriptor = msg('record.key', { key: 'Đang mở trang' });
  assert.equal(formatMessage(descriptor, 'en'), 'A record is missing the key Đang mở trang. Check the deduplication key or leave it empty to compare full content.');
  const previous = catalog['job.started'][0];
  try { catalog['job.started'][0] = 'Câu mới'; assert.equal(formatMessage(msg('job.started'), 'en'), 'Data collection started.'); }
  finally { catalog['job.started'][0] = previous; }
  assert.equal(formatMessage('Đã lưu cụm 3: 4 bản ghi mới, 1 bản ghi trùng.', 'en'), 'Saved batch 3: 4 new records, 1 duplicates.');
});

test('A gap in committed pages cannot overwrite the remaining raw pages on resume', async t => {
  const { manager, config } = await fixture(t);
  const job = await manager.createAndStart(config('/fast')); await job.promise;
  const first = join(job.directory, 'pages', '00000001.json'), second = join(job.directory, 'pages', '00000002.json');
  const before = await digest(second); await rename(first, first + '.qa');
  const recovery = await new JobManager(manager.directory, sessions()).init(); t.after(() => recovery.close());
  const saved = recovery.get(job.id);
  assert.equal(saved.status, 'failed'); assert.equal(saved.errorMessage.code, 'checkpoint.pages');
  assert.throws(() => saved.start(), error => error.messageData.code === 'checkpoint.pages');
  assert.equal(await digest(second), before); assert.equal(recovery.slots.size, 0);
  assert.deepEqual((await readJson(await saved.export('json'))).map(record => record.id), [3]);
});
