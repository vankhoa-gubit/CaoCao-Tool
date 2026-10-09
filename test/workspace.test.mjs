import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { SourceWorkspace, normalizeSource } from '../src/workspace.mjs';
import { JobManager } from '../src/jobs.mjs';

let fixture, origin, root;
let active = 0, peak = 0, version = 1;
const sessions = { async closeAll() {} };
const config = (path = '/records', extra = {}) => ({ request: { url: origin + path }, extract: { itemsPath: 'items', uniqueKey: 'id' }, pagination: { mode: 'page', hasMorePath: 'more', totalPath: 'total' }, limits: { delayMs: 0, retries: 0 }, ...extra });
const input = (extra = {}) => ({ name: 'Hồ sơ mẫu', url: origin + '/records', mode: 'api', config: config(), fields: ['id', 'nested.title'], requiredFields: ['nested.title'], ...extra });
async function directory(prefix) { return mkdtemp(join(root, prefix)); }
async function until(read, predicate) { const end = Date.now() + 10000; for (;;) { const value = await read(); if (predicate(value)) return value; if (Date.now() > end) throw new Error('Timed out'); await new Promise(resolve => setTimeout(resolve, 15)); } }
async function request(url, body, method) { const response = await fetch(url, body === undefined ? { method: method || 'GET' } : { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { response, value: await response.json() }; }
before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true }); root = await directoryAtRoot();
  fixture = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin || 'http://localhost'), page = Number(url.searchParams.get('page') || 1);
    const send = value => response.end(JSON.stringify(value)); response.setHeader('Content-Type', 'application/json');
    if (url.pathname.startsWith('/slow')) { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 120)); active--; }
    if (url.pathname === '/bad') return send({ wrong: [] });
    if (url.pathname === '/missing.txt') { response.writeHead(404); return response.end('missing'); }
    if (url.pathname === '/okay.txt') return response.end('file');
    if (url.pathname === '/files') return send({ items: [{ id: 1, file: origin + '/okay.txt' }, { id: 2, file: origin + '/missing.txt' }], more: false, total: 2 });
    const records = version === 1 ? [{ id: 1, nested: { title: 'Xin chào' }, old: true, 'a,b': '=1+1' }, { id: 2, nested: { title: '' }, flag: false }, { id: 3, nested: { title: 'Giữ nguyên' }, zero: 0 }] : [{ id: 1, nested: { title: 'Changed' }, fresh: 42, 'a,b': '=1+1' }, { id: 3, nested: { title: 'Giữ nguyên' }, zero: 0 }, { id: 4, nested: { title: null }, fresh: 42 }];
    if (url.pathname === '/unknown') return send({ items: records });
    if (url.pathname === '/cursor') return send({ items: records, next: null });
    send({ items: records.slice((page - 1) * 2, page * 2), more: page < 2, total: records.length });
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${fixture.address().port}`;
});
async function directoryAtRoot() { return mkdtemp(join(projectRoot, '.qa', 'workspace-')); }
after(async () => { await new Promise(resolve => fixture.close(resolve)); });

test('Profiles normalize fields, preserve schedule and reject invalid paths/credentials reuse', async () => {
  const source = normalizeSource(input({ schedule: { enabled: true, intervalMinutes: 5 }, fields: ['id', 'id', ' nested.title '] }), null, 100000);
  assert.deepEqual(source.fields, ['id', 'nested.title']); assert.equal(source.schedule.nextRunAt, new Date(400000).toISOString());
  assert.equal(normalizeSource(input({ schedule: { enabled: true, intervalMinutes: 5 } }), source, 200000).schedule.nextRunAt, source.schedule.nextRunAt);
  for (const extra of [{ fields: ['__proto__.x'] }, { schedule: { intervalMinutes: 0 } }, { url: 'file:///secret' }, { name: '' }]) assert.throws(() => normalizeSource(input(extra)), /.+/);
  const dir = await directory('profiles-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init(), workspace = await new SourceWorkspace(dir, manager, null).init();
  try {
    const saved = await workspace.saveSource(input());
    await assert.rejects(workspace.enqueue({ sourceId: saved.id, urls: ['https://other.example/api'] }), error => error.messageData.code === 'source.crossOrigin');
    const restored = await new SourceWorkspace(dir, manager, null).init(); assert.deepEqual(restored.source(saved.id), saved);
  } finally { await workspace.close(); await manager.close(); }
});

test('Queue shares two admission slots, retries only failed items and resumes a limited run', async () => {
  const dir = await directory('queue-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init();
  const workspace = await new SourceWorkspace(dir, manager, null, { tickMs: 15 }).init(); peak = 0;
  try {
    const saved = await workspace.saveSource(input({ config: config('/slow', { limits: { maxRequests: 1, delayMs: 0, retries: 0 } }), url: origin + '/slow' }));
    const queued = await workspace.enqueue({ sourceId: saved.id, urls: [origin + '/slow?a=1', origin + '/slow?a=2', origin + '/slow?a=3', origin + '/slow?a=1'] });
    assert.equal(queued.length, 3); workspace.start();
    await until(() => workspace.snapshot(), value => value.queue.length === 3 && value.queue.every(item => item.status === 'limited') && !value.active);
    assert.equal(peak, 2); assert.equal(manager.slots.size, 0);
    const item = workspace.item(queued[0].id), jobId = item.jobId;
    await workspace.retry(item.id);
    await until(() => workspace.item(item.id), value => value.status === 'completed');
    assert.equal(workspace.item(item.id).jobId, jobId); assert.equal(manager.get(jobId).progress.items, 3); assert.equal(workspace.item(item.id).attempts, 2);
    await assert.rejects(workspace.retry(item.id)); await assert.rejects(workspace.cancel(item.id));
    const bad = await workspace.saveSource(input({ config: config('/bad'), url: origin + '/bad' }));
    const [failure] = await workspace.enqueue({ sourceId: bad.id });
    await until(() => workspace.item(failure.id), value => value.status === 'failed');
    assert.equal(workspace.item(failure.id).errorMessage.code, 'record.array');
    const failedJobId = workspace.item(failure.id).jobId;
    await workspace.saveSource(input({ config: config('/records'), url: origin + '/bad' }), bad.id);
    // An existing failed job resumes its frozen request config, not an edited profile.
    await workspace.retry(failure.id); await until(() => workspace.item(failure.id), value => value.attempts === 2 && value.status === 'failed');
    assert.equal(workspace.item(failure.id).jobId, failedJobId);
  } finally { await workspace.close(); await manager.close(); }
});

test('Cancel and shutdown abort scans, persist interrupted state and free slots', async () => {
  const dir = await directory('cancel-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init();
  let scans = 0;
  const workspace = await new SourceWorkspace(dir, manager, async (url, signal) => { scans++; await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); }, { tickMs: 15 }).init();
  const [first] = await workspace.enqueue({ urls: [origin + '/one'] });
  await until(() => scans, value => value === 1); await workspace.cancel(first.id);
  assert.equal(workspace.item(first.id).status, 'cancelled'); assert.equal(manager.slots.size, 0);
  const [second] = await workspace.enqueue({ urls: [origin + '/two'] }); await until(() => scans, value => value === 2);
  await workspace.close(); assert.equal(manager.slots.size, 0); await manager.close();
  const reloaded = await new SourceWorkspace(dir, manager, null).init(); assert.equal(reloaded.item(second.id).status, 'paused'); await reloaded.close();
});

test('Automatic profiles analyze every new run, keep configured fields and retry a blocked scan independently', async () => {
  const dir = await directory('auto-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init();
  let calls = 0, blocked = true;
  const workspace = await new SourceWorkspace(dir, manager, async () => { calls++; return blocked ? { capability: 'login', messageData: { code: 'scan.login', params: {} } } : { capability: 'high', recommendation: { ...config(), kind: 'api' } }; }, { tickMs: 10 }).init();
  try {
    const source = await workspace.saveSource(input({ mode: 'auto' })), [item] = await workspace.enqueue({ sourceId: source.id }); workspace.start();
    await until(() => workspace.item(item.id), value => value.status === 'failed'); assert.equal(workspace.item(item.id).jobId, null); assert.equal(workspace.item(item.id).errorMessage.code, 'scan.login');
    blocked = false; await workspace.retry(item.id); await until(() => workspace.item(item.id), value => value.status === 'completed');
    assert.deepEqual(manager.get(workspace.item(item.id).jobId).config.exportFields, ['id', 'nested.title']); assert.equal(calls, 2);
    const [second] = await workspace.enqueue({ sourceId: source.id }); await until(() => workspace.item(second.id), value => value.status === 'completed'); assert.equal(calls, 3);
  } finally { await workspace.close(); await manager.close(); }
});

test('Schedules persist due times, enqueue one overdue run and skip overlapping runs', async () => {
  let now = 100000;
  const dir = await directory('schedule-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init();
  const workspace = await new SourceWorkspace(dir, manager, null, { now: () => now }).init();
  try {
    const source = await workspace.saveSource(input({ url: origin + '/slow', config: config('/slow'), schedule: { enabled: true, intervalMinutes: 1 } }));
    now += 600000; await Promise.all([workspace.tick(), workspace.tick(), workspace.tick()]);
    assert.equal(workspace.store.queue.length, 1); assert.equal(workspace.store.queue[0].trigger, 'schedule');
    assert.equal(workspace.source(source.id).schedule.nextRunAt, new Date(now + 60000).toISOString());
    await assert.rejects(workspace.deleteSource(source.id), error => error.messageData.code === 'source.inUse');
    now += 60000; await workspace.tick(); assert.equal(workspace.store.queue.length, 1);
    await until(() => workspace.snapshot(), value => !value.active && value.queue[0].status === 'completed');
    await workspace.close();
    const recovered = await new SourceWorkspace(dir, manager, null, { now: () => now }).init();
    assert.equal(recovered.source(source.id).schedule.nextRunAt, new Date(now + 60000).toISOString()); await recovered.close();
  } finally { await workspace.close(); await manager.close(); }
});

test('Corrupt workspace is reported without overwriting original file', async () => {
  const dir = await directory('corrupt-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init();
  await writeFile(join(dir, 'workspace.json'), '{broken');
  await assert.rejects(new SourceWorkspace(dir, manager, null).init(), error => error.messageData.code === 'workspace.store');
  assert.equal(await readFile(join(dir, 'workspace.json'), 'utf8'), '{broken'); await manager.close();
});

test('HTTP source history, records, filtered exports, comparisons and quality use committed real data', async () => {
  const dir = await directory('api-'), app = await createApp({ dataDirectory: dir, sessions }), base = await listen(app, 0); version = 1;
  try {
    const source = (await request(base + '/api/sources', input())).value;
    const queue = (await request(base + `/api/sources/${source.id}/run`, {})).value.queue[0];
    await until(() => app.workspace.item(queue.id), value => value.status === 'completed'); const first = app.workspace.item(queue.id).jobId;
    let result = await request(base + `/api/jobs/${first}/records?page=9&limit=2&columns=` + encodeURIComponent(JSON.stringify(['id', 'nested.title', 'a,b'])));
    assert.equal(result.value.pagination.page, 2); assert.equal(result.value.rows[0].index, 2); assert.deepEqual(result.value.rows[0].values, [3, 'Giữ nguyên', null]);
    result = await request(base + `/api/jobs/${first}/records?search=` + encodeURIComponent('xin chào')); assert.equal(result.value.pagination.total, 1);
    assert.deepEqual((await request(base + `/api/jobs/${first}/records/1`)).value.record.nested, { title: '' });
    assert.equal((await request(base + `/api/jobs/${first}/records/999`)).response.status, 404);
    const query = '?search=' + encodeURIComponent('xin chào') + '&columns=' + encodeURIComponent(JSON.stringify(['id', 'nested.title', 'a,b']));
    const exported = await fetch(base + `/api/jobs/${first}/records/export/json` + query); assert.deepEqual(await exported.json(), [{ id: 1, 'nested.title': 'Xin chào', 'a,b': '=1+1' }]);
    const csv = await (await fetch(base + `/api/jobs/${first}/records/export/csv` + query)).text(); assert.match(csv, /"'\=1\+1"/); assert.match(csv, /"a,b"/);
    const jsonl = await (await fetch(base + `/api/jobs/${first}/records/export/jsonl` + query)).text(); assert.equal(jsonl.trim().split('\n').length, 1);
    for (const suffix of ['?limit=201', '?columns=%5B%22__proto__.x%22%5D', '?columns=wrong']) assert.equal((await request(base + `/api/jobs/${first}/records` + suffix)).response.status, 400);
    const before = (await request(base + `/api/jobs/${first}/quality`)).value;
    assert.equal(before.completeness.level, 'total'); assert.equal(before.requiredRecordErrors, 1);
    assert.equal(before.fields.find(field => field.path === 'flag').empty, 0); assert.equal(before.fields.find(field => field.path === 'zero').empty, 0);
    version = 2; const nextQueue = (await request(base + `/api/sources/${source.id}/run`, {})).value.queue[0];
    await until(() => app.workspace.item(nextQueue.id), value => value.status === 'completed'); const second = app.workspace.item(nextQueue.id).jobId;
    const compare = (await request(base + `/api/jobs/${second}/compare?base=${first}`)).value;
    assert.deepEqual(compare.counts, { added: 1, changed: 1, missing: 1, unchanged: 1 }); assert.equal(compare.missingConfirmed, true);
    assert.equal((await request(base + `/api/jobs/${second}/compare?base=${first}&type=changed`)).value.rows[0].key, 1);
    assert.equal((await request(base + `/api/jobs/${second}/compare?base=${second}`)).response.status, 400);
    const after = (await request(base + `/api/jobs/${second}/quality`)).value;
    assert.ok(after.schema.added.includes('fresh')); assert.ok(after.schema.missing.includes('old')); assert.equal(after.requiredRecordErrors, 1);
    assert.ok(after.schema.changedTypes.some(field => field.path === 'nested.title'));
    const runs = (await request(base + `/api/sources/${source.id}/runs?limit=1`)).value; assert.equal(runs.pagination.total, 2); assert.equal(runs.jobs.length, 1); assert.equal(runs.jobs[0].sourceId, source.id);
    assert.equal((await fetch(base + '/workspace-i18n.js')).status, 200);
    assert.equal((await request(base + `/api/sources/${source.id}`, undefined, 'DELETE')).value.deleted, true);
    assert.ok((await readdir(join(dir, 'jobs', first, 'pages'))).length > 0);
  } finally { version = 1; await app.close(); }
});

test('Cancelled queued items never create jobs; direct jobs and queue share available admission', async () => {
  const dir = await directory('admission-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init(), workspace = await new SourceWorkspace(dir, manager, null, { tickMs: 10 }).init();
  const a = Symbol('direct-creation'), b = Symbol('direct-creation'); manager.admit(a); manager.admit(b);
  try {
    const source = await workspace.saveSource(input()), [queued] = await workspace.enqueue({ sourceId: source.id });
    await workspace.cancel(queued.id); manager.release(a); manager.release(b); await workspace.tick();
    assert.equal(workspace.item(queued.id).jobId, null); assert.equal(manager.jobs.size, 0);
    const direct = await manager.createAndStart(config('/slow')); const next = await workspace.saveSource(input({ url: origin + '/slow', config: config('/slow') }));
    const items = await workspace.enqueue({ sourceId: next.id, urls: [origin + '/slow?a=1', origin + '/slow?a=2'] });
    await workspace.tick(); assert.equal(manager.slots.size, 2); assert.equal(workspace.active.size, 1);
    workspace.start(); await until(() => workspace.snapshot(), value => !value.active && items.every(item => workspace.item(item.id).status === 'completed'));
    await direct.promise; assert.equal(manager.slots.size, 0);
  } finally { manager.release(a); manager.release(b); await workspace.close(); await manager.close(); }
});

test('Server restores interrupted runs paused and starts persisted pending work only after listening', async () => {
  const dir = await directory('restart-'), app = await createApp({ dataDirectory: dir, sessions });
  const source = await app.workspace.saveSource(input());
  const job = await app.manager.create(config('/records', { sourceId: source.id }));
  await app.close(); job.status = 'running'; await job.persist();
  const row = { id: 'interrupted', sourceId: source.id, url: source.url, name: source.name, trigger: 'manual', status: 'running', jobId: job.id, attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), errorMessage: null };
  const store = JSON.parse(await readFile(join(dir, 'workspace.json'), 'utf8')); store.queue.push(row, { ...row, id: 'waiting', jobId: null, attempts: 0, status: 'queued' }); await writeFile(join(dir, 'workspace.json'), JSON.stringify(store));
  const restored = await createApp({ dataDirectory: dir, sessions });
  try {
    assert.equal(restored.workspace.item('interrupted').status, 'paused'); assert.equal(restored.workspace.item('waiting').status, 'queued'); assert.equal(restored.manager.jobs.size, 1);
    await listen(restored, 0); await until(() => restored.workspace.item('waiting'), value => value.status === 'completed');
    assert.equal(restored.manager.jobs.size, 2); assert.equal(restored.workspace.item('interrupted').status, 'paused');
    await restored.workspace.retry('interrupted'); await until(() => restored.workspace.item('interrupted'), value => value.status === 'completed');
    assert.equal(restored.workspace.item('interrupted').jobId, job.id);
  } finally { await restored.close(); }
});

test('Shutdown during pending job creation leaves a durable paused job and releases admission', async () => {
  const dir = await directory('close-create-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init(), workspace = await new SourceWorkspace(dir, manager, null).init();
  const original = manager.create.bind(manager); let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; }); manager.create = async config => { entered = true; await gate; return original(config); };
  const source = await workspace.saveSource(input()), [item] = await workspace.enqueue({ sourceId: source.id });
  await until(() => entered, value => value);
  const closing = workspace.close(); release(); await closing;
  assert.equal(manager.slots.size, 0); assert.equal(workspace.item(item.id).status, 'paused');
  assert.equal(manager.get(workspace.item(item.id).jobId).progress.items, 0); await manager.close();
});

test('Queue follows jobs resumed through Quick collection and blocks deleting an active source', async () => {
  const dir = await directory('direct-resume-'), manager = await new JobManager(join(dir, 'jobs'), sessions).init(), workspace = await new SourceWorkspace(dir, manager, null).init();
  try {
    const source = await workspace.saveSource(input({ url: origin + '/slow', config: config('/slow', { limits: { maxRequests: 1, retries: 0, delayMs: 0 } }) }));
    const [item] = await workspace.enqueue({ sourceId: source.id }); await until(() => workspace.snapshot(), value => !value.active && value.queue[0].status === 'limited');
    const job = manager.get(workspace.item(item.id).jobId); job.start();
    assert.equal(workspace.snapshot().queue[0].status, 'running');
    await assert.rejects(workspace.retry(item.id), error => error.messageData.code === 'queue.retry');
    await assert.rejects(workspace.deleteSource(source.id), error => error.messageData.code === 'source.inUse');
    await workspace.cancel(item.id); assert.equal(job.status, 'paused'); assert.equal(workspace.snapshot().queue[0].status, 'cancelled');
    job.start(); await job.promise; assert.equal(workspace.snapshot().queue[0].status, 'completed');
    await assert.rejects(workspace.retry(item.id), error => error.messageData.code === 'queue.retry');
  } finally { await workspace.close(); await manager.close(); }
});

test('File errors retain source records, reports survive restart and unverified/partial runs warn on missing', async () => {
  const dir = await directory('quality-'), app = await createApp({ dataDirectory: dir, sessions });
  try {
    const files = await app.manager.createAndStart(config('/files', { download: { enabled: true, paths: ['file'] } })); await files.promise;
    assert.equal(files.status, 'completed'); assert.equal(files.progress.items, 2); assert.equal(files.progress.files, 1); assert.equal(files.progress.fileErrors, 1);
    const quality = await app.datasets.quality(files.id); assert.equal(quality.fileErrorCount, 1); assert.match(quality.fileErrors[0].url, /missing.txt/);
    const source = await app.workspace.saveSource(input());
    const unverified = await app.manager.createAndStart(config('/unknown', { sourceId: source.id, pagination: { mode: 'none' } })); await unverified.promise;
    assert.equal((await app.datasets.quality(unverified.id)).completeness.level, 'unverified');
    const cursor = await app.manager.createAndStart(config('/cursor', { sourceId: source.id, pagination: { mode: 'cursor', nextPath: 'next' } })); await cursor.promise;
    assert.equal((await app.datasets.quality(cursor.id)).completeness.level, 'sourceEnd');
    const partial = await app.manager.createAndStart(config('/records', { sourceId: source.id, limits: { maxRequests: 1, retries: 0 } })); await partial.promise;
    assert.equal((await app.datasets.compare(partial.id, unverified.id)).missingConfirmed, false);
    await app.close(); const restored = await createApp({ dataDirectory: dir, sessions });
    try { assert.equal((await restored.datasets.quality(files.id)).fileErrorCount, 1); assert.equal((await restored.datasets.quality(cursor.id)).completeness.level, 'sourceEnd'); } finally { await restored.close(); }
  } finally { await app.close(); }
});

test('Quality/compare keep completion evidence from the snapshot even when the job finishes during reading', async () => {
  const dir = await directory('report-snapshot-'), app = await createApp({ dataDirectory: dir, sessions });
  try {
    const source = await app.workspace.saveSource(input());
    const base = await app.manager.createAndStart(config('/records', { sourceId: source.id })); await base.promise;
    const current = await app.manager.createAndStart(config('/records', { sourceId: source.id })); await current.promise;
    current.status = 'running';
    const original = app.datasets.pages.bind(app.datasets); let release, entered = false;
    const gate = new Promise(resolve => { release = resolve; });
    app.datasets.pages = async function* (job, count) { if (job.id === current.id) { entered = true; await gate; } yield* original(job, count); };
    const pending = app.datasets.compare(current.id, base.id); await until(() => entered, value => value);
    current.status = 'completed'; release(); const comparison = await pending;
    assert.equal(comparison.missingConfirmed, false);
    const report = await app.datasets.rawQuality({ ...current, status: 'running' }); assert.equal(report.completeness.level, 'partial');
  } finally { await app.close(); }
});
