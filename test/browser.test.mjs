import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import http from 'node:http';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { BrowserSessions, scanWebsite, readDom } from '../src/browser.mjs';

let app, origin, directory, ui, screenshotDirectory, observedReport;
const browserErrors = [];
before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  directory = await mkdtemp(join(projectRoot, '.qa', 'browser-'));
  screenshotDirectory = join(projectRoot, '.qa', 'screenshots'); await mkdir(screenshotDirectory, { recursive: true });
  app = await createApp({ dataDirectory: directory, scanOptions: { rounds: 2, waitMs: 500 } }); origin = await listen(app, 0);
  ui = await new BrowserSessions(join(directory, 'ui-session')).open(origin);
  ui.page.on('pageerror', error => browserErrors.push(error.message));
});
after(async () => { await ui?.close(); await app?.close(); });

async function output(job) { return JSON.parse(await readFile(await job.export('json'), 'utf8')); }
async function until(read, condition, timeout = 60000) {
  const start = Date.now();
  while (true) { const value = await read(); if (condition(value)) return value; if (Date.now() - start > timeout) throw new Error('Không đạt trạng thái mong đợi trong thời gian kiểm tra.'); await new Promise(resolve => setTimeout(resolve, 150)); }
}

test('UI E2E: URL → nhận diện cụm → tải 18 bản ghi và 18 file → JSON', { timeout: 90000 }, async () => {
  await ui.page.setViewportSize({ width: 1440, height: 1000 });
  await ui.page.goto(origin);
  await ui.page.screenshot({ path: join(screenshotDirectory, 'desktop-empty.png'), fullPage: true });
  await ui.page.locator('#demo-infinite').click();
  await ui.page.locator('#report').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal(await ui.page.locator('#capability').innerText(), 'Nhận diện tốt');
  assert.equal(await ui.page.locator('#report-pagination').innerText(), 'Trang trong từng cụm');
  observedReport = [...app.scans.values()].at(-1).report;
  assert.equal(observedReport.recommendedMode, 'api'); assert.equal(observedReport.apiVerified, true);
  await ui.page.locator('#download-files').check(); await ui.page.locator('#start-job').click();
  await until(() => ui.page.locator('#job-status').innerText(), value => value === 'Đã kết thúc');
  assert.equal(await ui.page.locator('#job-items').innerText(), '18');
  const job = [...app.manager.jobs.values()].at(-1); assert.equal(job.config.kind, 'api'); assert.equal(job.progress.pages, 6); assert.equal(job.progress.files, 18);
  const response = await fetch(origin + `/api/jobs/${job.id}/export/json`); const records = await response.json();
  assert.equal(records.length, 18); assert.equal(new Set(records.map(item => item.id)).size, 18);
  await ui.page.screenshot({ path: join(screenshotDirectory, 'desktop-completed.png'), fullPage: true });
});
test('Trình duyệt: tự theo nút trang tiếp và lấy đủ nội dung 4 trang', { timeout: 90000 }, async () => {
  const report = await scanWebsite(origin + '/demo/paginated', app.sessions, () => {}, undefined, { rounds: 1, waitMs: 500 });
  assert.equal(report.capability, 'medium'); assert.equal(report.recommendedMode, 'browser'); assert.ok(report.actions.includes('page'));
  const job = await app.manager.create({ ...report.recommendation, limits: { maxRequests: 20, delayMs: 0 } }); job.start(); await job.promise;
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 18); assert.equal(job.progress.pages, 4);
  const records = await output(job); assert.equal(records.length, 18); assert.ok(records.some(record => record.title === 'Tài liệu mẫu 18'));
});
test('Trình duyệt: quan sát JSON khi cuộn qua nhiều cụm, không cần replay API', { timeout: 90000 }, async () => {
  const job = await app.manager.create({ ...observedReport.browserConfig, limits: { maxRequests: 20, delayMs: 0 } }); job.start(); await job.promise;
  assert.equal(job.status, 'completed', job.error); assert.equal(job.progress.items, 18); assert.ok(job.progress.requests >= 6);
  assert.equal(new Set((await output(job)).map(record => record.id)).size, 18);
});
test('Trình duyệt: giới hạn mỗi lượt, mở lại và lọc dữ liệu đã lưu', { timeout: 90000 }, async () => {
  const job = await app.manager.create({ ...observedReport.browserConfig, limits: { maxRequests: 2, delayMs: 0 } }); job.start(); await job.promise;
  assert.equal(job.status, 'limited'); const firstCount = job.progress.items; assert.ok(firstCount > 0 && firstCount < 18);
  job.start(); await job.promise; assert.ok(job.progress.items > firstCount); assert.equal((await output(job)).length, job.progress.items);
});
test('Nhận diện: báo trang bị chặn và không cho tạo tác vụ tự động', { timeout: 60000 }, async () => {
  const response = await fetch(origin + '/api/scans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: origin + '/demo/blocked' }) });
  const scan = await response.json();
  const result = await until(async () => (await fetch(origin + '/api/scans/' + scan.id)).json(), value => value.status !== 'running');
  assert.equal(result.report.capability, 'blocked');
  const start = await fetch(origin + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scanId: scan.id }) }); assert.equal(start.status, 400);
});
test('UI: không lỗi JavaScript, layout 320/375/414/768px và dữ liệu hiển thị', async () => {
  for (const width of [320, 375, 414, 768]) {
    await ui.page.setViewportSize({ width, height: 900 });
    await ui.page.waitForTimeout(100);
    const dimensions = await ui.page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll('button:not([hidden])')].filter(button => button.offsetWidth > 0).map(button => ({ text: button.innerText, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })) }));
    assert.ok(dimensions.scroll <= width + 1, `Tràn ngang ở ${width}px: ${dimensions.scroll}`);
    for (const button of dimensions.buttons) assert.ok(button.left >= 0 && button.right <= width + 1, `Nút vượt màn hình ${width}px: ${button.text}`);
    await ui.page.screenshot({ path: join(screenshotDirectory, `mobile-${width}.png`), fullPage: true });
  }
  assert.deepEqual(browserErrors, []);
});
test('Server: từ chối request từ Origin bên ngoài và Host giả', async () => {
  const originResponse = await fetch(origin + '/api/jobs', { headers: { Origin: 'https://outside.example' } }); assert.equal(originResponse.status, 403);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(origin + '/api/jobs', { headers: { Host: 'outside.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
});
test('DOM: danh sách hơn 500 bản ghi được lấy đầy đủ', async () => {
  const page = await ui.context.newPage();
  try {
    await page.setContent(`<main>${Array.from({ length: 600 }, (_, index) => `<article data-id="${index}"><h2>Bản ghi ${index}</h2><p>Nội dung kiểm tra danh sách dài trên một trang.</p></article>`).join('')}</main>`);
    const dom = await readDom(page); assert.equal(dom.records.length, 600); assert.equal(dom.records.at(-1).title, 'Bản ghi 599');
  } finally { await page.close(); }
});

test('UI: nhập file archive TXT nhận diện URL, đọc tổng và giữ cấu hình request', { timeout: 60000 }, async () => {
  await ui.page.goto(origin);
  await ui.page.locator('#advanced').evaluate(element => { element.open = true; });
  const configBefore = await ui.page.locator('#config-editor').inputValue();
  const records = Array.from({ length: 30 }, (_, i) => ({ questionId: i + 1, content: `Mẫu kiểm tra ${i + 1}` }));
  const archive = { items: records, position: { engine: 'browser', pageUrl: origin + '/demo/infinite' }, response: { captures: [{ url: origin + '/session', response: { initialFlashcards: { items: records, totalQuestions: 379, hasMore: true, nextOffset: 30 } } }] } };
  await ui.page.locator('#import-file').setInputFiles({ name: 'Pasted text.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(archive)) });
  await ui.page.locator('#report').waitFor({ state: 'visible', timeout: 50000 });
  assert.equal(await ui.page.locator('#site-url').inputValue(), origin + '/demo/infinite');
  assert.match(await ui.page.locator('#preview-result').innerText(), /30 \/ 379/);
  assert.match(await ui.page.locator('#preview-result').innerText(), /Offset tiếp theo: 30/);
  assert.equal(await ui.page.locator('#config-editor').inputValue(), configBefore);
  assert.equal([...app.scans.values()].at(-1).report.recommendedMode, 'api');
  assert.deepEqual(browserErrors, []);
});
