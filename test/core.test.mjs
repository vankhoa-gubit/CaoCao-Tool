import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { JobManager, csvValue } from '../src/jobs.mjs';
import { normalizeConfig, buildRequest, initialState, setAt, getAt } from '../src/config.mjs';
import { parseCurl, importInput } from '../src/import.mjs';
import { analyzeCaptures } from '../src/detect.mjs';
import { projectRoot } from '../src/server.mjs';

let fixture, origin, directory, manager;
const seen = [];
const sessions = { async closeAll() {} };
let rateAttempts = 0;
const items = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, title: `Bản ghi ${i + 1}` }));

before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  directory = await mkdtemp(join(projectRoot, '.qa', 'core-'));
  fixture = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { body = null; }
    const url = new URL(request.url, origin || 'http://localhost');
    seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), body, headers: request.headers });
    const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    const page = Number(url.searchParams.get('page')) || 1;
    if (url.pathname === '/page' || url.pathname === '/slow') {
      if (url.pathname === '/slow') await new Promise(resolve => setTimeout(resolve, 35));
      send({ data: { items: items.slice((page - 1) * 2, page * 2) }, meta: { hasMore: page < 3, total: 6 } });
    } else if (url.pathname === '/offset') { const offset = Number(url.searchParams.get('offset')) || 0; send({ items: items.slice(offset, offset + 2) }); }
    else if (url.pathname === '/cursor') { const cursor = body?.variables?.after; send({ data: { items: cursor ? items.slice(3) : items.slice(0, 3), pageInfo: { endCursor: cursor ? null : 'next-three', hasNextPage: !cursor } } }); }
    else if (url.pathname === '/link') { const next = url.searchParams.get('token') === 'second'; send({ items: next ? items.slice(3) : items.slice(0, 3), next: next ? null : '/link?token=second' }); }
    else if (url.pathname === '/batch') { const names = ['one', 'two', 'three']; const batch = names.indexOf(url.searchParams.get('batch') || 'one'); send({ items: [{ id: batch * 2 + page }], meta: { hasMorePages: page < 2, nextBatch: names[batch + 1] || null, hasMoreBatches: batch < 2 } }); }
    else if (url.pathname === '/batch-zero') { const names = ['one', 'two']; const batch = names.indexOf(url.searchParams.get('batch') || 'one'); const index = Number(url.searchParams.get('page')) || 0; send({ items: [{ id: batch * 2 + index + 1, title: 'Mẫu' }], meta: { hasMorePages: index < 1, nextBatch: names[batch + 1] || null, hasMoreBatches: batch < 1 } }); }
    else if (url.pathname === '/duplicate') send({ items: page === 1 ? items.slice(0, 3) : items.slice(2), meta: { hasMore: page < 2 } });
    else if (url.pathname === '/loop-cursor') send({ items: [items[0]], next: 'same' });
    else if (url.pathname === '/loop-page') send({ items: [items[0]], meta: { hasMore: true } });
    else if (url.pathname === '/rate') { if (rateAttempts++ === 0) { response.writeHead(429, { 'Retry-After': '0' }); response.end(); } else send({ items }); }
    else if (url.pathname === '/file-list') send({ items: [{ id: 1, fileUrl: `${origin}/file.txt` }, { id: 2, fileUrl: `${origin}/file.txt` }] });
    else if (url.pathname === '/file.txt') { response.writeHead(200, { 'Content-Type': 'text/plain' }); response.end('Nội dung file UTF-8.\n'); }
    else if (url.pathname === '/bad') send({ different: [] });
    else if (url.pathname === '/csv') send({ items: [{ id: 1, title: '=1+1', notes: 'Xin chào, "Việt Nam"', nested: { ok: true } }, { id: 2, other: 'cột mới' }] });
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${fixture.address().port}`;
  manager = await new JobManager(join(directory, 'jobs'), sessions).init();
});
after(async () => { await manager.close(); await new Promise(resolve => fixture.close(resolve)); });

function config(route, extra = {}) {
  return { name: route, request: { url: origin + route }, extract: { itemsPath: 'items', uniqueKey: 'id' }, limits: { delayMs: 0, retries: 0 }, ...extra };
}
async function run(input) { const job = await manager.create(input); job.start(); await job.promise; return job; }
async function exported(job) { return JSON.parse(await readFile(await job.export('json'), 'utf8')); }

test('API: phân trang, tổng khai báo và xuất đủ 6 bản ghi', async () => {
  const job = await run(config('/page', { extract: { itemsPath: 'data.items', uniqueKey: 'id' }, pagination: { mode: 'page', hasMorePath: 'meta.hasMore', totalPath: 'meta.total' } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.pages, 3); assert.equal(job.progress.total, 6);
  assert.deepEqual((await exported(job)).map(item => item.id), [1, 2, 3, 4, 5, 6]);
});
test('API: offset dừng ở trang rỗng và không bỏ bản ghi', async () => {
  const job = await run(config('/offset', { pagination: { mode: 'offset', start: 0, step: 2 } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.items, 6); assert.equal(job.progress.pages, 4);
});
test('API: cursor trong payload JSON lồng nhau giữ nguyên bộ lọc', async () => {
  const job = await run(config('/cursor', { request: { url: origin + '/cursor', method: 'POST', bodyType: 'json', body: { filters: { tag: 'keep' }, variables: { first: 3 } } }, extract: { itemsPath: 'data.items', uniqueKey: 'id' }, pagination: { mode: 'cursor', location: 'body', param: 'variables.after', nextPath: 'data.pageInfo.endCursor', hasMorePath: 'data.pageInfo.hasNextPage' } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.items, 6);
  const requests = seen.filter(request => request.path === '/cursor');
  assert.deepEqual(requests[1].body.filters, { tag: 'keep' }); assert.equal(requests[1].body.variables.after, 'next-three');
});
test('API: theo URL tiếp theo dạng tương đối', async () => {
  const job = await run(config('/link', { pagination: { mode: 'nextUrl', nextPath: 'next' } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.items, 6); assert.equal(job.progress.pages, 2);
});
test('API: chỉ chuyển cụm sau khi hết trang trong cụm', async () => {
  const job = await run(config('/batch', { pagination: { mode: 'batch', hasMorePath: 'meta.hasMorePages', batch: { start: 'one', nextPath: 'meta.nextBatch', hasMorePath: 'meta.hasMoreBatches' } } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.items, 6);
  assert.deepEqual(seen.filter(request => request.path === '/batch').map(request => [request.query.batch, request.query.page]), [['one', '1'], ['one', '2'], ['two', '1'], ['two', '2'], ['three', '1'], ['three', '2']]);
});
test('API: loại trùng cả giữa các trang', async () => {
  const job = await run(config('/duplicate', { pagination: { mode: 'page', hasMorePath: 'meta.hasMore' } }));
  assert.equal(job.progress.items, 6); assert.equal(job.progress.duplicates, 1); assert.equal((await exported(job)).length, 6);
});
test('Nhận diện và tải: page bắt đầu 0, cụm đầu không có token', async () => {
  const candidates = analyzeCaptures([
    { url: origin + '/batch-zero?page=0', method: 'GET', headers: {}, body: null, response: { items: [{ id: 1, title: 'Mẫu' }], meta: { hasMorePages: true, nextBatch: 'two', hasMoreBatches: true } } },
    { url: origin + '/batch-zero?page=0&batch=two', method: 'GET', headers: {}, body: null, response: { items: [{ id: 3, title: 'Mẫu' }], meta: { hasMorePages: true, nextBatch: null, hasMoreBatches: false } } },
  ]);
  const job = await run({ ...candidates[0].apiConfig, limits: { delayMs: 0 } });
  assert.equal(job.status, 'completed'); assert.deepEqual((await exported(job)).map(item => item.id), [1, 2, 3, 4]);
  assert.deepEqual(seen.filter(request => request.path === '/batch-zero').map(request => [request.query.batch ?? null, request.query.page]), [[null, '0'], [null, '1'], ['two', '0'], ['two', '1']]);
});
test('API: cursor lặp báo lỗi và giữ phần đã lưu', async () => {
  const job = await run(config('/loop-cursor', { pagination: { mode: 'cursor', nextPath: 'next' } }));
  assert.equal(job.status, 'failed'); assert.match(job.error, /Cursor không thay đổi/); assert.equal(job.progress.items, 1);
});
test('API: nguồn bỏ qua page được phát hiện sau 3 trang giống nhau', async () => {
  const job = await run(config('/loop-page', { pagination: { mode: 'page', hasMorePath: 'meta.hasMore' } }));
  assert.equal(job.status, 'failed'); assert.match(job.error, /3 lần liên tiếp/); assert.equal(job.progress.pages, 2);
});
test('API: retry HTTP 429 rồi tải thành công', async () => {
  const job = await run(config('/rate', { limits: { delayMs: 0, retries: 1 } }));
  assert.equal(job.status, 'completed'); assert.equal(rateAttempts, 2); assert.equal(job.progress.requests, 2);
});
test('API: itemsPath sai không báo hoàn thành giả', async () => {
  const job = await run(config('/bad'));
  assert.equal(job.status, 'failed'); assert.match(job.error, /Không tìm thấy mảng/); assert.equal(job.progress.pages, 0);
});
test('API: đạt giới hạn có thể chạy tiếp tới cuối', async () => {
  const job = await run(config('/page', { extract: { itemsPath: 'data.items', uniqueKey: 'id' }, pagination: { mode: 'page', hasMorePath: 'meta.hasMore' }, limits: { maxRequests: 1, delayMs: 0 } }));
  assert.equal(job.status, 'limited'); assert.equal(job.progress.items, 2);
  job.start(); await job.promise; assert.equal(job.progress.items, 4);
  job.start(); await job.promise; assert.equal(job.status, 'completed'); assert.equal(job.progress.items, 6);
});
test('API: tạm dừng, khởi động lại manager và tiếp tục không trùng', async () => {
  const job = await manager.create(config('/slow', { extract: { itemsPath: 'data.items', uniqueKey: 'id' }, pagination: { mode: 'page', hasMorePath: 'meta.hasMore' }, limits: { delayMs: 200 } }));
  job.start(); while (job.progress.pages < 1) await new Promise(resolve => setTimeout(resolve, 10));
  await job.pause(); assert.equal(job.status, 'paused');
  const recoveredManager = await new JobManager(manager.directory, sessions).init(); const recovered = recoveredManager.get(job.id);
  recovered.start(); await recovered.promise;
  assert.equal(recovered.status, 'completed'); assert.deepEqual((await exported(recovered)).map(item => item.id), [1, 2, 3, 4, 5, 6]);
  await recoveredManager.close();
});
test('API: trang đã ghi nhưng checkpoint cũ được khôi phục', async () => {
  const job = await run(config('/page', { extract: { itemsPath: 'data.items', uniqueKey: 'id' }, pagination: { mode: 'page', hasMorePath: 'meta.hasMore' }, limits: { maxRequests: 1, delayMs: 0 } }));
  const snapshotPath = join(job.directory, 'checkpoint.json'); const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  snapshot.checkpointPage = 0; snapshot.state = initialState(job.config); snapshot.progress.pages = 0;
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const recoveredManager = await new JobManager(manager.directory, sessions).init(); const recovered = recoveredManager.get(job.id);
  assert.equal(recovered.state.value, 2); assert.equal(recovered.progress.items, 2); await recoveredManager.close();
});
test('File: tải file, loại URL file trùng và lưu nội dung UTF-8', async () => {
  const job = await run(config('/file-list', { download: { enabled: true, paths: ['fileUrl'] } }));
  assert.equal(job.status, 'completed'); assert.equal(job.progress.files, 1);
  const files = await readdir(join(job.directory, 'files')); assert.equal(files.length, 1); assert.ok((await stat(join(job.directory, 'files', files[0]))).size > 0);
  assert.match(await readFile(join(job.directory, 'files', files[0]), 'utf8'), /Nội dung file/);
});
test('Export: JSONL hợp lệ, CSV hợp nhất cột và bảo vệ công thức', async () => {
  const job = await run(config('/csv'));
  const jsonl = await readFile(await job.export('jsonl'), 'utf8'); assert.equal(jsonl.trim().split('\n').map(JSON.parse).length, 2);
  const csv = await readFile(await job.export('csv'), 'utf8'); assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv, /other/); assert.match(csv, /'=1\+1/); assert.match(csv, /""Việt Nam""/);
  assert.equal(csvValue(-12), '"-12"');
});
test('Config: chặn prototype pollution khi cập nhật payload', () => {
  assert.throws(() => setAt({}, '__proto__.polluted', true)); assert.equal({}.polluted, undefined);
  const body = { filters: { keep: true } }; setAt(body, 'variables.after', 'abc'); assert.equal(getAt(body, 'variables.after'), 'abc');
});
test('Config: cursor số 0 không bị coi là rỗng', () => {
  const cfg = normalizeConfig(config('/cursor', { pagination: { mode: 'cursor', start: 0, nextPath: 'next' } }));
  assert.equal(new URL(buildRequest(cfg, initialState(cfg)).url).searchParams.get('cursor'), '0');
});
test('Import: cURL bash giữ payload, cookie và không thực thi shell', () => {
  const request = parseCurl(`curl '${origin}/cursor' -H 'Content-Type: application/json' -b 'session=abc' --data-raw '{"variables":{"first":3},"text":"$(whoami)"}'`);
  assert.equal(request.method, 'POST'); assert.equal(request.body.text, '$(whoami)'); assert.equal(request.headers.cookie, 'session=abc');
});
test('Import: cURL Windows cmd với nháy caret', () => {
  const request = parseCurl(`curl "${origin}/cursor" --data-raw "{^"page^":1}" -H "Content-Type: application/json"`);
  assert.deepEqual(request.body, { page: 1 });
});
test('Import: HAR cho phép chọn đúng request JSON', () => {
  const source = JSON.stringify({ log: { entries: [{ request: { url: origin + '/page', method: 'GET', headers: [] }, response: { status: 200, content: { mimeType: 'application/json', text: '{"data":{"items":[{"id":1}]}}' } } }] } });
  assert.equal(importInput(source).candidates.length, 1); assert.equal(importInput(source, 0).paths[0].path, 'data.items');
});
test('Nhận diện: tự suy ra phân trang trong cụm từ request/response', () => {
  const candidates = analyzeCaptures([{ url: origin + '/batch?batch=one&page=1', method: 'GET', headers: {}, body: null, response: { data: { items: [{ id: 1, title: 'Mẫu' }] }, meta: { hasMorePages: true, nextBatch: 'two', hasMoreBatches: true } } }]);
  assert.equal(candidates[0].apiConfig.pagination.mode, 'batch'); assert.equal(candidates[0].apiConfig.pagination.batch.start, 'one');
});
test('Nhận diện: cursor vắng ở request đầu và xuất hiện ở request sau', () => {
  const candidates = analyzeCaptures([
    { url: origin + '/cursor', method: 'POST', headers: {}, body: { variables: { first: 3 } }, response: { data: { items: [{ id: 1, title: 'Mẫu' }], pageInfo: { endCursor: 'abc', hasNextPage: true } } } },
    { url: origin + '/cursor', method: 'POST', headers: {}, body: { variables: { first: 3, after: 'abc' } }, response: { data: { items: [{ id: 2, title: 'Mẫu 2' }], pageInfo: { endCursor: null, hasNextPage: false } } } },
  ]);
  assert.equal(candidates[0].apiConfig.pagination.mode, 'cursor'); assert.equal(candidates[0].apiConfig.pagination.start, null); assert.equal(candidates[0].apiConfig.pagination.param, 'variables.after');
});
