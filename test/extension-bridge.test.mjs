import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { normalizeCapture } from '../src/capture.mjs';

let app, origin, directory, secret;
const sessions = { async open() { throw new Error('Captured imports must never open the source browser'); }, async closeAll() {} };
const sample = (overrides = {}) => ({ captureId: randomUUID(), kind: 'question', source: { url: 'https://quizlet.com/vn/1119631382/example-flash-cards?funnelUUID=tracking&token=secret', title: 'Bộ thẻ thật trong tab', adapter: 'quizlet' }, expectedTotal: 2, records: [{ body: 'First term', answer: 'Định nghĩa thứ nhất', sourceId: 'first' }, { body: 'Second term', answer: 'Dòng một\nDòng hai', sourceId: 'second' }], ...overrides });
async function request(path, body, options = {}) {
  const response = await fetch(origin + path, { method: options.method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, value: await response.json() };
}
async function until(predicate) { const end = Date.now() + 15000; for (;;) { const value = await predicate(); if (value) return value; if (Date.now() > end) throw new Error('Capture import timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } }
async function startApp() { app = await createApp({ dataDirectory: directory, sessions }); origin = await listen(app, 0); secret = (await readFile(join(directory, 'extension-bridge.key'), 'utf8')).trim(); }
before(async () => { await mkdir(join(projectRoot, '.qa'), { recursive: true }); directory = await mkdtemp(join(projectRoot, '.qa', 'extension-bridge-')); await startApp(); });
after(async () => { await app?.close(); if (!directory.startsWith(join(projectRoot, '.qa') + sep)) throw new Error('Unexpected QA directory'); await rm(directory, { recursive: true, force: true }); });

test('Capture bridge rejects missing credentials, browser origins and unintended install requests', async () => {
  let result = await request('/api/extension/health', undefined, { headers: { Authorization: '' } }); assert.equal(result.status, 401);
  result = await request('/api/extension/health', undefined, { headers: { Origin: origin } }); assert.equal(result.status, 401);
  result = await request('/api/extension/health', undefined, { headers: { Origin: 'https://untrusted.example' } }); assert.equal(result.status, 403);
  result = await request('/api/extension/install', { install: false }); assert.equal(result.status, 400);
  result = await request('/api/extension/health'); assert.equal(result.value.app, 'cao-cao'); assert.equal(result.value.protocol, 1); assert.equal(result.value.secret, undefined);
});
test('Preview writes no library items, persists only approved fields and preserves multiline answers', async () => {
  const before = app.library.db.prepare('SELECT count(*) n FROM items').get().n, input = sample();
  input.cookies = [{ value: 'must-not-be-stored' }]; input.records[0].headers = { Authorization: 'must-not-be-stored' };
  const result = await request('/api/extension/previews', input); assert.equal(result.status, 201);
  assert.equal(result.value.count, 2); assert.equal(result.value.completeness, 'complete'); assert.equal(result.value.sample[1].answer, 'Dòng một\nDòng hai');
  assert.equal(result.value.source.url, 'https://quizlet.com/vn/1119631382/example-flash-cards');
  const payload = app.library.db.prepare('SELECT payload FROM browser_captures WHERE id=?').get(result.value.id).payload;
  assert.doesNotMatch(payload, /must-not-be-stored|tracking|token=|funnelUUID|Authorization|cookies/);
  assert.equal(app.library.db.prepare('SELECT count(*) n FROM items').get().n, before);
  assert.equal(app.library.db.prepare('SELECT count(*) n FROM imports').get().n, 0);
});
test('Repeating a preview is idempotent, and a reused snapshot ID cannot change reviewed content', async () => {
  const input = sample(), first = await request('/api/extension/previews', input), repeat = await request('/api/extension/previews', input);
  assert.equal(repeat.value.id, first.value.id);
  input.records[0].answer = 'Changed after review';
  const changed = await request('/api/extension/previews', input); assert.equal(changed.status, 409);
});
test('Confirmed snapshots import without jobs or source access and survive app restart', async () => {
  const sentinelId = app.library.saveRecord({ title: 'Sentinel', body: 'Existing unrelated article', url: 'https://sentinel.example/article' }, { kind: 'article' }, 0);
  const before = app.library.item(sentinelId), input = sample();
  const preview = (await request('/api/extension/previews', input)).value;
  await app.close(); await startApp();
  assert.equal((await request('/api/extension/previews/' + preview.id)).value.count, 2);
  const collection = app.library.saveCollection({ name: 'Extension test' });
  const first = await request('/api/extension/imports', { id: preview.id, collectionId: collection.id }); assert.equal(first.status, 202);
  const repeated = await request('/api/extension/imports', { id: preview.id, collectionId: collection.id }); assert.equal(repeated.status, 200); assert.equal(repeated.value.id, first.value.id);
  await until(() => app.library.imports().find(value => value.id === first.value.id && value.status === 'completed'));
  const items = app.library.list({ kind: 'question' }).items.map(row => app.library.item(row.id));
  assert.deepEqual(items.map(item => item.answer).sort(), ['Dòng một\nDòng hai', 'Định nghĩa thứ nhất'].sort());
  assert.ok(items.every(item => item.collection_id === collection.id)); assert.equal(app.manager.jobs.size, 0);
  assert.deepEqual(app.library.item(sentinelId), before);
  await app.close(); await startApp();
  assert.equal((await request('/api/extension/imports', { id: preview.id })).value.id, first.value.id);
});
test('Invalid captures, expired snapshots and nonexistent destinations do not create imports', async () => {
  const before = app.library.db.prepare('SELECT count(*) n FROM imports').get().n;
  for (const input of [sample({ records: [] }), sample({ kind: 'other' }), sample({ expectedTotal: -1 }), sample({ records: [{ body: 'Question', answer: '', url: 'javascript:alert(1)' }] }), sample({ records: [{ body: 'Question', answer: '', url: 'https://different.example/' }] }), sample({ records: Array.from({ length: 5001 }, () => ({ body: 'Question' })) })]) {
    assert.equal((await request('/api/extension/previews', input)).status, 400);
  }
  const value = (await request('/api/extension/previews', sample())).value;
  assert.equal((await request('/api/extension/imports', { id: value.id, collectionId: 987654 })).status, 404);
  app.library.db.prepare('UPDATE browser_captures SET expires_at=? WHERE id=?').run(Date.now() - 1, value.id);
  assert.equal((await request('/api/extension/imports', { id: value.id })).value.errorMessage.code, 'learning.captureExpired');
  assert.equal(app.library.db.prepare('SELECT count(*) n FROM imports').get().n, before);
});
test('Deduplication and unknown totals never manufacture source completeness', () => {
  const input = sample(); input.records.push(input.records[0]); input.expectedTotal = 3;
  let value = normalizeCapture(input); assert.equal(value.records.length, 2); assert.equal(value.completeness, 'partial');
  value = normalizeCapture(sample({ expectedTotal: null, completeness: 'complete' })); assert.equal(value.completeness, 'unknown');
  value = normalizeCapture(sample({ truncated: true })); assert.equal(value.completeness, 'partial');
  assert.throws(() => normalizeCapture(sample({ source: { url: 'https://user:password@example.com/' } })), error => error.messageData?.code === 'learning.captureInvalid');
});

test('Native connection starts a stopped application using an isolated library directory', { timeout: 25000 }, async () => {
  const isolated = await mkdtemp(join(projectRoot, '.qa', 'extension-autostart-'));
  const manifest = JSON.parse(await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const child = spawn(process.execPath, [join(projectRoot, 'scripts', 'native-host.mjs'), `chrome-extension://${id}/`], { env: { ...process.env, CAOCAO_DATA_DIR: isolated, CAOCAO_BRIDGE_PORT: '0' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = Buffer.alloc(0), result, descriptor;
  child.stdout.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) result = JSON.parse(buffer.subarray(4, buffer.readUInt32LE() + 4)); });
  try {
    const bytes = Buffer.from(JSON.stringify({ id: 1, command: 'health' })), size = Buffer.alloc(4); size.writeUInt32LE(bytes.length); child.stdin.write(Buffer.concat([size, bytes]));
    await until(() => result);
    assert.equal(result.ok, true); assert.equal(result.result.app, 'cao-cao');
    descriptor = JSON.parse(await readFile(join(isolated, 'extension-bridge.json'), 'utf8'));
    assert.ok(Number.isSafeInteger(descriptor.pid) && descriptor.pid !== process.pid);
    assert.equal(result.result.url, descriptor.origin);
    assert.equal((await fetch(descriptor.origin + '/api/health').then(response => response.json())).outputPath, isolated);
  } finally {
    child.stdin.end(); child.kill();
    descriptor ||= JSON.parse(await readFile(join(isolated, 'extension-bridge.json'), 'utf8').catch(() => 'null'));
    if (descriptor?.pid && descriptor.pid !== process.pid) { try { process.kill(descriptor.pid); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await rm(isolated, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
test('Native host frames fragmented and queued requests and rejects arbitrary commands', async () => {
  const manifest = JSON.parse(await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const child = spawn(process.execPath, [join(projectRoot, 'scripts', 'native-host.mjs'), `chrome-extension://${id}/`], { env: { ...process.env, CAOCAO_DATA_DIR: directory }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = Buffer.alloc(0); const results = [], errors = [];
  child.stderr.on('data', chunk => errors.push(chunk.toString()));
  child.stdout.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) { const length = buffer.readUInt32LE(); results.push(JSON.parse(buffer.subarray(4, length + 4))); buffer = buffer.subarray(length + 4); } });
  const frame = message => { const bytes = Buffer.from(JSON.stringify(message)), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length, bytes]); };
  try {
    const first = frame({ id: 1, command: 'health' }); child.stdin.write(first.subarray(0, 2)); child.stdin.write(Buffer.concat([first.subarray(2), frame({ id: 2, command: 'constructor' }), frame({ id: 3, command: 'getPreview', payload: { id: '../secret' } })]));
    await until(() => results.length === 3);
    assert.equal(results[0].result.app, 'cao-cao'); assert.equal(results[1].error, 'invalidCommand'); assert.equal(results[2].error, 'invalidCommand');
    assert.doesNotMatch(JSON.stringify(results), new RegExp(secret)); assert.deepEqual(errors, []);
  } finally { child.stdin.end(); child.kill(); }
});

test('Native startup refuses to open a second application over a running older library', async () => {
  const isolated = await mkdtemp(join(projectRoot, '.qa', 'extension-existing-'));
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, version: '1.4.0', outputPath: isolated })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const manifest = JSON.parse(await readFile(join(projectRoot, 'extension', 'manifest.json'), 'utf8'));
  const id = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
  const child = spawn(process.execPath, [join(projectRoot, 'scripts', 'native-host.mjs'), `chrome-extension://${id}/`], { env: { ...process.env, CAOCAO_DATA_DIR: isolated, CAOCAO_BRIDGE_PORT: String(server.address().port) }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = Buffer.alloc(0), result;
  child.stdout.on('data', chunk => { buffer = Buffer.concat([buffer, chunk]); if (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE() + 4) result = JSON.parse(buffer.subarray(4, buffer.readUInt32LE() + 4)); });
  try {
    const bytes = Buffer.from(JSON.stringify({ id: 1, command: 'health' })), length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); child.stdin.write(Buffer.concat([length, bytes]));
    await until(() => result);
    assert.equal(result.ok, false); assert.equal(result.error, 'learning.extensionRestart');
    await assert.rejects(readFile(join(isolated, 'extension-bridge.key')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(isolated, 'library', 'library.sqlite')), { code: 'ENOENT' });
  } finally { child.stdin.end(); child.kill(); await new Promise(resolve => server.close(resolve)); await rm(isolated, { recursive: true, force: true }); }
});
