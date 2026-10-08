import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { BrowserSessions } from '../src/browser.mjs';

let app, ui, fixture, origin, remote, directory, sourceId, firstId, secondId, revision = 1, broken = true, now = Date.now();
const errors = [];
async function until(read, predicate) { const end = Date.now() + 15000; for (;;) { const value = await read(); if (predicate(value)) return value; if (Date.now() > end) throw new Error('Expected browser state was not reached'); await new Promise(resolve => setTimeout(resolve, 40)); } }
before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true }); directory = await mkdtemp(join(projectRoot, '.qa', 'workspace-ui-'));
  fixture = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost'); response.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/lost.txt') { response.writeHead(404); return response.end('missing'); }
    if (url.pathname === '/bad' && broken) return response.end('{"wrong":[]}');
    if (url.pathname === '/slow') await new Promise(resolve => setTimeout(resolve, 500));
    const records = Array.from({ length: 57 }, (_, i) => ({ id: i + 1, nested: { title: i === 1 ? '' : `Dữ liệu ${i + 1}` }, zero: 0, flag: false, ...(i === 1 ? { file: remote + '/lost.txt' } : {}), ...(i === 0 ? { large: 'Nội dung gốc '.repeat(400), csv: '=1+1' } : {}), old: true }));
    if (revision === 2) { records[0].nested.title = 'Đã sửa'; records.splice(1, 1); records.push({ id: 58, nested: { title: 'Mới' }, fresh: true }); }
    const page = Number(url.searchParams.get('page') || 1); response.end(JSON.stringify({ items: records.slice((page - 1) * 10, page * 10), total: 57, more: page < 6 }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve)); remote = `http://127.0.0.1:${fixture.address().port}`;
  app = await createApp({ dataDirectory: directory, workspaceOptions: { now: () => now } }); origin = await listen(app, 0);
  ui = await new BrowserSessions(join(directory, 'ui-session')).open(origin); ui.page.on('pageerror', error => errors.push(error.message));
});
after(async () => { await ui?.close(); await app?.close(); await new Promise(resolve => fixture.close(resolve)); });

test('Source form saves API pagination/fields/download/schedule; language switch keeps form values and focus', async () => {
  const page = ui.page; await page.goto(origin);
  await page.locator('[data-panel="sources"]').click();
  await page.locator('#profile-name').fill('Nguồn nghiên cứu'); await page.locator('#profile-url').fill(remote + '/data');
  await page.locator('#profile-mode').selectOption('api'); await page.locator('#profile-api-url').fill(remote + '/data');
  await page.locator('#profile-items').fill('items'); await page.locator('#profile-key').fill('id');
  await page.locator('#profile-pagination').selectOption('page'); await page.locator('#profile-more').fill('more'); await page.locator('#profile-total').fill('total');
  await page.locator('#profile-fields').fill('id\nnested.title'); await page.locator('#profile-required').fill('nested.title');
  await page.locator('.source-request-options summary').click(); await page.locator('#profile-delay').fill('0'); await page.locator('#profile-limit').fill('200'); await page.locator('#profile-download').check(); await page.locator('#profile-file-paths').fill('file');
  await page.locator('#profile-schedule').check(); await page.locator('#profile-interval').fill('1');
  await page.locator('[data-language="en"]').click();
  assert.equal(await page.locator('#profile-name').inputValue(), 'Nguồn nghiên cứu'); assert.equal(await page.locator('#profile-fields').inputValue(), 'id\nnested.title');
  await page.locator('#save-source').click(); await until(() => app.workspace.store.sources.length, value => value === 1); sourceId = app.workspace.store.sources[0].id;
  const source = app.workspace.source(sourceId); assert.equal(source.config.pagination.hasMorePath, 'more'); assert.equal(source.config.download.enabled, true); assert.equal(source.schedule.enabled, true);
  await page.locator('#profile-name').focus(); await page.locator('#refresh-workspace').click(); await page.locator('#profile-name').focus();
  await until(() => page.locator('#source-list button').count(), value => value === 1); assert.equal(await page.locator('#profile-name').evaluate(node => document.activeElement === node), true);
  await page.locator('#run-source').click();
  await until(() => app.workspace.snapshot(), value => value.queue.some(item => item.status === 'completed'));
  firstId = app.workspace.store.queue[0].jobId;
  await page.locator('#refresh-workspace').click(); await until(() => page.locator('#source-runs button').count(), value => value === 1);
  assert.match(await page.locator('#queue-counts').innerText(), /up to 2/);
});

test('Browser records paginate, search, project nested columns, show complete JSON and download filtered JSON/CSV', async () => {
  const page = ui.page; await page.locator('#source-runs button').first().click();
  await until(() => page.locator('#data-table tbody tr').count(), value => value === 25);
  assert.match(await page.locator('#data-page').innerText(), /1\/3.*57/);
  await page.locator('#data-next').click(); await until(() => page.locator('#data-page').innerText(), value => value.startsWith('Page 2/3'));
  assert.equal(await page.locator('#data-table tbody tr').first().locator('td').nth(1).innerText(), '26');
  await page.locator('#data-search').fill('Dữ liệu 37'); await until(() => page.locator('#data-table tbody tr').count(), value => value === 1);
  assert.equal(await page.locator('#data-table tbody tr').first().locator('td').nth(1).innerText(), '37');
  await page.locator('[data-language="vi"]').click(); assert.equal(await page.locator('#data-search').inputValue(), 'Dữ liệu 37');
  assert.match(await page.locator('#data-page').innerText(), /Trang 1\/1.*1 bản ghi/);
  const jsonLink = await page.locator('#filtered-json').getAttribute('href'), result = await ui.context.request.get(origin + jsonLink);
  assert.deepEqual(await result.json(), [{ id: 37, 'nested.title': 'Dữ liệu 37' }]);
  await page.locator('#data-search').fill('Nội dung gốc'); await until(() => page.locator('#data-table tbody tr').count(), value => value === 1);
  await until(() => page.locator('#data-table tbody tr').first().locator('td').nth(1).innerText(), value => value === '1');
  await page.locator('#data-table button').click(); await page.locator('#record-dialog').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#record-json').innerText()).length > 4000); assert.match(await page.locator('#record-json').innerText(), /Nội dung gốc/); await page.locator('#close-record').click();
  await page.locator('.column-picker summary').click();
  await page.locator('#data-field-path').fill('csv'); await page.locator('#data-add-column').click(); await page.locator('#apply-columns').click();
  await until(() => page.locator('#data-table th').allTextContents(), value => value.includes('csv'));
  const csvLink = await page.locator('#filtered-csv').getAttribute('href'), csv = await ui.context.request.get(origin + csvLink); assert.match(await csv.text(), /"'\=1\+1"/);
  assert.equal(await page.locator('#record-dialog').evaluate(node => node.open), false);
});

test('Quality reports display required empty fields/file failures, and comparison opens before/after originals', async () => {
  const page = ui.page; await page.locator('[data-data-tab="quality"]').click();
  await until(() => page.locator('#quality-summary').innerText(), value => value.includes('57 bản ghi'));
  assert.match(await page.locator('#quality-summary').innerText(), /1 lỗi file.*1 bản ghi thiếu/); assert.match(await page.locator('#quality-confidence').innerText(), /Đủ theo tổng/);
  assert.match(await page.locator('#quality-files').innerText(), /lost.txt/);
  revision = 2; await page.locator('[data-panel="sources"]').click(); await page.locator('#run-source').click();
  await until(() => app.workspace.store.queue, value => value.length === 2 && value.every(item => item.status === 'completed'));
  secondId = app.workspace.store.queue[1].jobId; await page.locator('#refresh-workspace').click();
  await until(() => page.locator('#source-runs button').count(), value => value === 2); await page.locator('#source-runs button').first().click();
  await until(() => page.locator('#dataset-name').innerText(), value => value.includes('Nguồn nghiên cứu'));
  await page.locator('[data-data-tab="compare"]').click(); await page.locator('#compare-base').selectOption(firstId); await page.locator('#compare-show').click();
  await until(() => page.locator('#compare-summary').innerText(), value => value.includes('1 mới'));
  assert.match(await page.locator('#compare-summary').innerText(), /1 mới · 1 thay đổi · 1 vắng mặt · 55 không đổi/); assert.equal(await page.locator('#compare-warning').isHidden(), true);
  await page.locator('#compare-type').selectOption('changed'); await until(() => page.locator('#compare-table tbody tr').count(), value => value === 1);
  await page.locator('#compare-table button').first().click(); await page.locator('#record-dialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#record-json').innerText(), /Dữ liệu 1/); await page.locator('#close-record').click();
  await page.locator('#compare-table button').last().click(); await page.locator('#record-dialog').waitFor({ state: 'visible' }); assert.match(await page.locator('#record-json').innerText(), /Đã sửa/); await page.locator('#close-record').click();
  await page.locator('[data-data-tab="quality"]').click(); await until(() => page.locator('#quality-schema').innerText(), value => value.includes('fresh'));
  await page.locator('[data-language="en"]').click(); assert.match(await page.locator('#quality-confidence').innerText(), /Complete according to source total/); assert.match(await page.locator('#quality-schema').innerText(), /Added: fresh/);
});

test('Multiple URLs show independent failures, retry the failed run and cancel a running queue item', async () => {
  const page = ui.page; await page.locator('[data-panel="sources"]').click();
  await page.locator('#queue-profile').selectOption(sourceId); await page.locator('#queue-urls').fill(remote + '/data?other=1\n' + remote + '/bad'); await page.locator('#queue-add').click();
  await until(() => app.workspace.store.queue, value => value.length === 4 && value.some(item => item.status === 'failed'));
  await page.locator('#refresh-workspace').click(); await until(() => page.locator('#queue-list [data-queue-action$="/retry"]').count(), value => value === 1);
  broken = false; const failed = app.workspace.store.queue.find(item => item.status === 'failed'), id = failed.id, jobId = failed.jobId;
  await page.locator('#queue-list [data-queue-action$="/retry"]').click(); await until(() => app.workspace.item(id), value => value.status === 'completed'); assert.equal(app.workspace.item(id).jobId, jobId);
  await page.locator('#queue-urls').fill(remote + '/slow'); await page.locator('#queue-add').click();
  await until(() => page.locator('#queue-list [data-queue-action$="/cancel"]').count(), value => value >= 1);
  const cancelled = page.waitForResponse(response => /\/api\/queue\/[\w-]+\/cancel$/.test(response.url()) && response.request().method() === 'POST');
  await page.locator('#queue-list [data-queue-action$="/cancel"]').first().click(); await cancelled; await until(() => app.workspace.store.queue.at(-1).status, value => value === 'cancelled');
  assert.equal(app.manager.slots.size, 0);
});

test('Saved schedule launches one due run and exposes updated source history', async () => {
  now += 600000; await app.workspace.tick();
  await until(() => app.workspace.snapshot(), value => value.queue.some(item => item.trigger === 'schedule' && item.status === 'completed'));
  const scheduled = app.workspace.store.queue.filter(item => item.trigger === 'schedule'); assert.equal(scheduled.length, 1); assert.equal(app.manager.get(scheduled[0].jobId).config.sourceId, sourceId);
  await ui.page.locator('#refresh-workspace').click(); assert.match(await ui.page.locator('#profile-next-run').innerText(), /Next run/);
});

test('Workspace controls fit desktop/tablet/mobile in both languages; no browser errors', async () => {
  const page = ui.page;
  for (const language of ['vi', 'en']) for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height }); await page.locator(`[data-language="${language}"]`).click();
    for (const panel of ['sources', 'data']) {
      await page.locator(`[data-panel="${panel}"]`).click();
      if (panel === 'data') await page.locator('[data-data-tab="records"]').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const controls = await page.locator(`#${panel}-panel button:visible, #${panel}-panel input:visible, #${panel}-panel select:visible, #${panel}-panel textarea:visible`).evaluateAll(nodes => nodes.filter(node => !node.closest('.table-scroll')).map(node => { const rect = node.getBoundingClientRect(); return { id: node.id, left: rect.left, right: rect.right }; }));
      assert.deepEqual(controls.filter(rect => rect.left < -1 || rect.right > width + 1), []);
      await page.screenshot({ path: join(directory, `${panel}-${language}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []); console.log(`Workspace UI evidence: ${directory}`);
});

test('Quick analysis pre-fills a reusable source profile and the saved profile collects the detected API', async () => {
  const page = ui.page; await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-panel="quick"]').click(); await page.locator('#demo-infinite').click();
  await page.locator('#report').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#save-analysis').click(); await page.locator('#sources-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#profile-mode').inputValue(), 'api'); assert.match(await page.locator('#profile-api-url').inputValue(), /demo\/batches/);
  await page.locator('#profile-name').fill('Nguồn từ nhận diện'); await page.locator('#save-source').click();
  await until(() => app.workspace.store.sources.length, value => value === 2);
  const source = app.workspace.store.sources.find(source => source.name === 'Nguồn từ nhận diện');
  assert.equal(source.config.extract.uniqueKey, 'id'); await page.locator('#run-source').click();
  await until(() => app.workspace.store.queue, value => value.some(item => item.sourceId === source.id && item.status === 'completed'));
  const item = app.workspace.store.queue.find(item => item.sourceId === source.id); assert.equal(app.manager.get(item.jobId).progress.items, 18);
  assert.deepEqual(errors, []);
});

test('URLs without a saved profile are analyzed and collected through the real queue', async () => {
  const page = ui.page; await page.locator('[data-panel="sources"]').click();
  await page.locator('#queue-profile').selectOption(''); await page.locator('#queue-urls').fill(origin + '/demo/infinite'); await page.locator('#queue-add').click();
  const queued = app.workspace.store.queue.at(-1);
  await until(() => app.workspace.item(queued.id), value => value.status === 'completed');
  const job = app.manager.get(app.workspace.item(queued.id).jobId); assert.equal(job.config.kind, 'api'); assert.equal(job.progress.items, 18); assert.equal(job.config.sourceId, undefined);
  assert.deepEqual(errors, []);
});
