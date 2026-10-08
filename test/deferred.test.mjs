import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { BrowserSessions, browserConfig } from '../src/browser.mjs';
import { JobManager } from '../src/jobs.mjs';
import { analyzeCaptures } from '../src/detect.mjs';
import { normalizeConfig } from '../src/config.mjs';

let fixture, origin, app, appOrigin, directory, ui, report;
let nextSession = 1000;
const studySessions = new Map(), calls = [];
const questions = total => Array.from({ length: total }, (_, i) => ({ questionId: i + 1, position: i, content: `Câu hỏi kiểm thử ${i + 1}`, term: `Thẻ mẫu ${i + 1}`, back: 'Dữ liệu mô phỏng' }));
function batch(session, offset = 0) {
  const size = session.variable && offset === 30 ? 15 : 30;
  const end = Math.min(offset + size, session.total), items = questions(session.total).slice(offset, end);
  if (session.overlap && offset > 0) items.unshift(questions(session.total)[offset - 1]);
  const hasMore = !session.premature && end < session.total;
  return { items, offset, limit: 30, totalQuestions: session.total, hasMore, nextOffset: hasMore ? end : null };
}
function initial(session, id) {
  return { sessionId: id, quizId: session.total, mode: 'LEARN', totalQuestions: session.total, batchSize: 30, initialFlashcards: batch(session) };
}
function captures(total = 370) {
  const session = { total };
  return [
    { url: origin + '/api/study-sessions', method: 'POST', headers: { ':authority': 'localhost', ':method': 'POST', ':path': '/api/study-sessions', ':scheme': 'http' }, body: { total }, bodyType: 'json', response: initial(session, 999) },
    { url: origin + '/api/study-sessions/999/flashcards?offset=30&limit=30', method: 'GET', headers: { ':authority': 'localhost', ':method': 'GET', ':path': '/api/study-sessions/999/flashcards', ':scheme': 'http', 'x-fixture': 'valid' }, body: null, response: batch(session, 30) },
  ];
}

before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  directory = await mkdtemp(join(projectRoot, '.qa', 'deferred-'));
  fixture = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin || 'http://localhost');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    calls.push({ method: request.method, path: url.pathname, offset: url.searchParams.get('offset') });
    const json = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    if (request.method === 'POST' && url.pathname === '/api/study-sessions') {
      const id = ++nextSession, session = { total: body.total || 370, variable: body.variable, overlap: body.overlap, premature: body.premature };
      studySessions.set(id, session); json(initial(session, id)); return;
    }
    const api = url.pathname.match(/^\/api\/study-sessions\/(\d+)\/flashcards$/);
    if (api && studySessions.has(Number(api[1]))) { json(batch(studySessions.get(Number(api[1])), Number(url.searchParams.get('offset')) || 0)); return; }
    const study = url.pathname.match(/^\/study\/(\d+)(?:\/(stall|freeze))?$/);
    if (study) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html lang="vi"><head><title>Quiz flashcard kiểm thử</title></head><body><main><h1>Flashcards kiểm thử</h1><p id="position"></p><section id="card"></section><button id="next" aria-label="Next card">→</button></main><script>
        let cards = [], position = 0, sessionId, total = ${Number(study[1])};
        const mode = ${JSON.stringify(study[2] || '')}, next = document.getElementById('next');
        function render() { document.getElementById('position').textContent = 'Câu ' + (position + 1) + ' / ' + total; document.getElementById('card').textContent = cards[position]?.content || 'Đang tải dữ liệu'; next.disabled = position >= cards.length - 1; }
        next.disabled = true;
        fetch('/api/study-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ total }) }).then(r => r.json()).then(data => { cards = data.initialFlashcards.items; sessionId = data.sessionId; render(); });
        next.addEventListener('click', async () => {
          if (mode === 'freeze') return;
          next.disabled = true; position++;
          if (mode !== 'stall' && position >= cards.length - 2 && cards.length < total) {
            const data = await fetch('/api/study-sessions/' + sessionId + '/flashcards?offset=' + cards.length + '&limit=30').then(r => r.json()); cards.push(...data.items);
          }
          render();
        });
      </script></body></html>`); return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${fixture.address().port}`;
  app = await createApp({ dataDirectory: directory, scanOptions: { rounds: 2, waitMs: 300 } });
  appOrigin = await listen(app, 0);
  ui = await new BrowserSessions(join(directory, 'ui')).open(appOrigin);
});
after(async () => { await ui?.close(); await app?.close(); await new Promise(resolve => fixture.close(resolve)); });
async function exported(job) { return JSON.parse(await readFile(await job.export('json'), 'utf8')); }
async function run(input) { const job = await app.manager.create(input); job.start(); await job.promise; return job; }
function browserInput(total, suffix = '', limits = {}) {
  return browserConfig(origin + `/study/${total}${suffix}`, analyzeCaptures(captures(total))[0], 'Flashcards kiểm thử', { delayMs: 0, ...limits });
}

test('Nhận diện: HTTP/2, totalQuestions, nextOffset, questionId và ưu tiên GET của phiên học', () => {
  const sources = analyzeCaptures(captures(379)), main = sources[0];
  assert.equal(main.method, 'GET'); assert.equal(main.pagination, 'offset'); assert.equal(main.total, 379);
  assert.equal(main.apiConfig.pagination.totalPath, 'totalQuestions'); assert.equal(main.apiConfig.pagination.nextPath, 'nextOffset');
  assert.equal(main.apiConfig.pagination.start, 0); assert.equal(main.apiConfig.pagination.step, 30);
  assert.equal(main.apiConfig.extract.uniqueKey, 'questionId'); assert.deepEqual(main.apiConfig.request.headers, { 'x-fixture': 'valid' });
  assert.equal(main.source.seed.itemsPath, 'initialFlashcards.items'); assert.equal(main.source.sessionPathIndex, 3);
  assert.throws(() => normalizeConfig({ request: { url: origin, headers: { 'x-test': 'bad\r\nvalue' } } }), /Header không hợp lệ/);
});

test('Nhận diện: metadata của danh sách khác không làm kết thúc sớm', () => {
  const data = captures(379)[1];
  data.response = { recommendations: { items: [{ id: 1 }], total: 1, hasMore: false }, data: { items: batch({ total: 379 }, 30).items, pageInfo: { totalQuestions: 379, hasMore: true, nextOffset: 60 } } };
  const source = analyzeCaptures([data]).find(item => item.itemsPath === 'data.items');
  assert.equal(source.total, 379); assert.equal(source.apiConfig.pagination.hasMorePath, 'data.pageInfo.hasMore');
});

test('UI E2E: URL → tìm cụm sau 28 lần Next → API → đủ 370/370 qua 13 cụm', { timeout: 90000 }, async () => {
  await ui.page.goto(appOrigin);
  await ui.page.locator('#site-url').fill(origin + '/study/370');
  const bootstrapBefore = calls.filter(call => call.method === 'POST').length;
  await ui.page.locator('#scan-button').click();
  await ui.page.locator('#report').waitFor({ state: 'visible', timeout: 60000 });
  report = [...app.scans.values()].at(-1).report;
  assert.equal(report.recommendedMode, 'api'); assert.equal(report.total, 370);
  assert.ok(report.actions.includes('nextItem')); assert.equal(report.candidates[0].method, 'GET');
  assert.equal(calls.filter(call => call.method === 'POST').length - bootstrapBefore, 1, 'Không replay POST tạo phiên để xác nhận API');
  await ui.page.locator('#start-job').click();
  await ui.page.locator('#job-status').filter({ hasText: 'Đã kết thúc' }).waitFor({ timeout: 30000 });
  const job = [...app.manager.jobs.values()].at(-1), records = await exported(job);
  assert.equal(job.config.kind, 'api'); assert.equal(job.progress.items, 370); assert.equal(job.progress.total, 370); assert.equal(job.progress.pages, 13);
  assert.equal(records.length, 370); assert.equal(new Set(records.map(item => item.questionId)).size, 370);
  assert.equal(await ui.page.locator('#job-items').innerText(), '370 / 370');
  assert.equal(await ui.page.locator('#job-progress').getAttribute('value'), '370');
  await ui.page.screenshot({ path: join(directory, 'ui-370-complete.png'), fullPage: true });
  await ui.page.setViewportSize({ width: 320, height: 900 });
  assert.ok(await ui.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Tiến độ 370/370 không tràn màn hình nhỏ');
  await ui.page.screenshot({ path: join(directory, 'ui-370-mobile.png'), fullPage: true });
  await ui.page.setViewportSize({ width: 1365, height: 900 });
});

test('API: 379 câu, cụm thay đổi kích thước và bản ghi trùng vẫn theo đúng nextOffset', async () => {
  const session = { total: 379, variable: true, overlap: true }, id = ++nextSession; studySessions.set(id, session);
  const source = analyzeCaptures([{ ...captures(379)[1], url: origin + `/api/study-sessions/${id}/flashcards?offset=0&limit=30`, response: batch(session) }])[0];
  const begin = calls.length, job = await run({ ...source.apiConfig, limits: { delayMs: 0 } });
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 379); assert.ok(job.progress.duplicates > 0);
  assert.deepEqual(calls.slice(begin, begin + 3).map(call => call.offset), ['0', '30', '45']);
  assert.equal(new Set((await exported(job)).map(item => item.questionId)).size, 379);
});

test('Browser: 370 câu qua 13 cụm, hơn 300 lần Next và session ID mới', { timeout: 120000 }, async () => {
  const config = { ...report.browserConfig, limits: { delayMs: 0 } }, job = await run(config);
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 370); assert.equal(job.progress.total, 370);
  assert.equal(job.progress.pages, 13); assert.ok(job.progress.actions > 300);
  const records = await exported(job); assert.equal(new Set(records.map(item => item.questionId)).size, 370);
  const firstPage = JSON.parse(await readFile(join(job.directory, 'pages', '00000001.json'), 'utf8'));
  assert.notEqual(String(firstPage.response.captures[0].response.sessionId), config.source.pathname.split('/')[config.source.sessionPathIndex]);
});

test('Browser: giới hạn 2 cụm, khôi phục manager và thu đủ 95 câu không trùng', { timeout: 90000 }, async () => {
  const job = await run(browserInput(95, '', { maxRequests: 2 }));
  assert.equal(job.status, 'limited'); assert.equal(job.progress.items, 60);
  const recoveredManager = await new JobManager(app.manager.directory, app.sessions).init();
  try {
    const recovered = recoveredManager.get(job.id); recovered.start(); await recovered.promise;
    assert.equal(recovered.status, 'completed', recovered.error); assert.equal(recovered.progress.items, 95);
    assert.equal(new Set((await exported(recovered)).map(item => item.questionId)).size, 95);
  } finally { await recoveredManager.close(); }
});

test('Browser: nguồn POST ban đầu tự chuyển sang GET phân cụm khi request mới xuất hiện', { timeout: 60000 }, async () => {
  const seed = analyzeCaptures([captures(65)[0]])[0];
  const job = await run(browserConfig(origin + '/study/65', seed, 'Nguồn bootstrap', { delayMs: 0 }));
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 65); assert.equal(job.progress.total, 65);
  assert.equal(new Set((await exported(job)).map(item => item.questionId)).size, 65);
});

test('Nhận diện: offset thiếu ở request đầu vẫn lấy offset 0 từ response', () => {
  const data = captures(379)[1], first = { ...data, url: origin + '/api/study-sessions/999/flashcards?limit=30', response: batch({ total: 379 }) };
  const source = analyzeCaptures([first, data])[0];
  assert.equal(source.apiConfig.pagination.mode, 'offset'); assert.equal(source.apiConfig.pagination.start, 0);
});

test('Browser: Next không đổi nội dung phải báo chưa đủ 30/370 và cho chạy tiếp', { timeout: 30000 }, async () => {
  const job = await run(browserInput(370, '/freeze'));
  assert.equal(job.status, 'incomplete'); assert.equal(job.progress.items, 30); assert.equal(job.progress.total, 370);
  assert.match(job.error, /30\/370/); assert.notEqual(job.state, null);
  job.start(); await job.promise; assert.equal(job.status, 'incomplete'); assert.equal(job.progress.items, 30);
});

test('Khôi phục: sửa trạng thái completed cũ từ metadata, giữ nguyên file 30 câu', { timeout: 30000 }, async () => {
  const job = await run(browserInput(370, '/freeze'));
  const checkpoint = join(job.directory, 'checkpoint.json'), snapshot = JSON.parse(await readFile(checkpoint, 'utf8'));
  const pagePath = join(job.directory, 'pages', '00000001.json'), original = await readFile(pagePath, 'utf8');
  snapshot.status = 'completed'; snapshot.state = null; snapshot.progress.total = null;
  await writeFile(checkpoint, JSON.stringify(snapshot));
  const recoveredManager = await new JobManager(app.manager.directory, app.sessions).init();
  try {
    const recovered = recoveredManager.get(job.id);
    assert.equal(recovered.status, 'incomplete'); assert.equal(recovered.progress.total, 370); assert.equal(recovered.progress.items, 30);
    assert.equal(await readFile(pagePath, 'utf8'), original);
  } finally { await recoveredManager.close(); }
});

test('API: kết thúc ở 30/379 báo incomplete; chạy tiếp lấy đủ và loại trùng', async () => {
  const session = { total: 379, premature: true }, id = ++nextSession; studySessions.set(id, session);
  const source = analyzeCaptures([{ ...captures(379)[1], url: origin + `/api/study-sessions/${id}/flashcards?offset=0&limit=30`, response: batch(session) }])[0];
  const job = await run({ ...source.apiConfig, limits: { delayMs: 0 } });
  assert.equal(job.status, 'incomplete'); assert.equal(job.progress.items, 30); assert.match(job.error, /30\/379/);
  session.premature = false; job.start(); await job.promise;
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 379);
  assert.equal(new Set((await exported(job)).map(item => item.questionId)).size, 379);
});

test('API nhận diện: phiên học đã ở giữa danh sách vẫn tải từ offset 0 đến đủ 379 câu', async () => {
  const session = { total: 379 }, id = ++nextSession; studySessions.set(id, session);
  const captured = captures(379);
  captured[0].response = { ...initial(session, id), currentPosition: 35, initialFlashcards: batch(session, 30) };
  captured[1].url = origin + `/api/study-sessions/${id}/flashcards?offset=60&limit=30`;
  captured[1].response = batch(session, 60);
  const source = analyzeCaptures(captured)[0];
  assert.equal(source.apiConfig.pagination.start, 0);
  const begin = calls.length, job = await run({ ...source.apiConfig, limits: { delayMs: 0 } });
  assert.equal(calls[begin].offset, '0'); assert.equal(job.status, 'completed', job.error);
  assert.equal(job.progress.items, 379); assert.equal(job.progress.duplicates, 0); assert.equal(job.progress.pages, 13);
  assert.deepEqual((await exported(job)).map(item => item.questionId), Array.from({ length: 379 }, (_, i) => i + 1));
});

test('Nhận diện: GET offset 90 không có bootstrap vẫn bắt đầu từ 0; cấu hình thủ công giữ offset đã chọn', () => {
  const captured = { ...captures(379)[1], url: origin + '/api/study-sessions/999/flashcards?offset=90&limit=30', response: batch({ total: 379 }, 90) };
  const source = analyzeCaptures([captured])[0];
  assert.equal(source.apiConfig.pagination.start, 0);
  assert.equal(normalizeConfig({ ...source.apiConfig, pagination: { ...source.apiConfig.pagination, start: 90 } }).pagination.start, 90);
});

test('API khôi phục: tác vụ 319/379 bắt đầu offset 60 chỉ tải bù hai cụm đầu', async () => {
  const session = { total: 379 }, id = ++nextSession; studySessions.set(id, session);
  const source = analyzeCaptures([{ ...captures(379)[1], url: origin + `/api/study-sessions/${id}/flashcards?offset=60&limit=30`, response: batch(session, 60) }])[0];
  const job = await run({ ...source.apiConfig, pagination: { ...source.apiConfig.pagination, start: 60 }, limits: { delayMs: 0 } });
  assert.equal(job.status, 'incomplete'); assert.equal(job.progress.items, 319); assert.equal(job.progress.pages, 11);
  assert.match(job.error, /offset 60/);
  const pagePath = join(job.directory, 'pages', '00000001.json'), original = await readFile(pagePath, 'utf8'), begin = calls.length;
  job.start(); await job.promise;
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 379); assert.equal(job.progress.duplicates, 0);
  assert.deepEqual(calls.slice(begin).map(call => call.offset), ['0', '30']);
  assert.equal(await readFile(pagePath, 'utf8'), original);
  assert.equal(new Set((await exported(job)).map(item => item.questionId)).size, 379);
});

test('API khôi phục: tạm dừng tải bù sau một cụm, mở manager mới và tiếp tục từ offset 30', async () => {
  const session = { total: 379 }, id = ++nextSession; studySessions.set(id, session);
  const source = analyzeCaptures([{ ...captures(379)[1], url: origin + `/api/study-sessions/${id}/flashcards?offset=60&limit=30`, response: batch(session, 60) }])[0];
  const job = await run({ ...source.apiConfig, pagination: { ...source.apiConfig.pagination, start: 60 }, limits: { delayMs: 0 } });
  job.config.limits.maxRequests = 1; job.start(); await job.promise;
  assert.equal(job.status, 'limited'); assert.equal(job.progress.items, 349); assert.equal(job.state.value, 30); assert.equal(job.state.prefixEnd, 60);
  const recoveredManager = await new JobManager(app.manager.directory, app.sessions).init();
  try {
    const recovered = recoveredManager.get(job.id), begin = calls.length; recovered.start(); await recovered.promise;
    assert.equal(recovered.status, 'completed', recovered.error); assert.equal(recovered.progress.items, 379);
    assert.deepEqual(calls.slice(begin).map(call => call.offset), ['30']);
    assert.equal(new Set((await exported(recovered)).map(item => item.questionId)).size, 379);
  } finally { await recoveredManager.close(); }
});
