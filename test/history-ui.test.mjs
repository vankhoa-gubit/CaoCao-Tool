import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { BrowserSessions } from '../src/browser.mjs';

let app, ui, origin, directory;
const errors = [];
async function until(read, condition) {
  const end = Date.now() + 10000;
  while (true) {
    const value = await read(); if (condition(value)) return value;
    if (Date.now() > end) throw new Error('Expected UI state was not reached');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  directory = await mkdtemp(join(projectRoot, '.qa', 'history-ui-'));
  app = await createApp({ dataDirectory: directory }); origin = await listen(app, 0);
  for (let i = 0; i < 37; i++) {
    const job = await app.manager.create({ name: `Nghiên cứu ${String(i).padStart(2, '0')}`, request: { url: origin + '/demo/infinite' } });
    job.status = i % 2 ? 'completed' : 'paused'; job.createdAt = new Date(1700000000000 + i).toISOString();
    job.samples = [{ text: 'Nội dung nguồn tiếng Việt' }]; await job.persist();
  }
  ui = await new BrowserSessions(join(directory, 'ui-session')).open(origin);
  ui.page.on('pageerror', error => errors.push(error.message));
});
after(async () => { await ui?.close(); await app?.close(); });

test('History reaches older runs, searches/filters and keeps focus/data while switching language', async () => {
  await ui.page.goto(origin);
  await until(() => ui.page.locator('#job-list button').count(), value => value === 15);
  assert.match(await ui.page.locator('#history-page').innerText(), /1\/3.*37/);
  await ui.page.locator('#history-next').click();
  await until(() => ui.page.locator('#history-page').innerText(), value => value.startsWith('Trang 2/3'));
  await ui.page.locator('#history-next').click();
  await until(() => ui.page.locator('#job-list button').count(), value => value === 7);
  await ui.page.getByRole('button', { name: /Nghiên cứu 00/ }).click();
  await until(() => ui.page.locator('#job-name').innerText(), value => value === 'Nghiên cứu 00');
  await ui.page.locator('#history-search').fill('Nghiên cứu 03');
  await until(() => ui.page.locator('#job-list button').count(), value => value === 1);
  await ui.page.locator('#history-status').selectOption('completed');
  await until(() => ui.page.locator('#job-name').innerText(), value => value === 'Nghiên cứu 03');
  await ui.page.locator('[data-language="en"]').click();
  assert.equal(await ui.page.locator('#history-search').inputValue(), 'Nghiên cứu 03');
  assert.equal(await ui.page.locator('#history-status').inputValue(), 'completed');
  assert.equal(await ui.page.locator('#job-name').innerText(), 'Nghiên cứu 03');
  assert.equal(await ui.page.locator('#history-page').innerText(), 'Page 1/1 · 1 runs');
  await ui.page.locator('#history-search').focus();
  await ui.page.locator('#refresh-jobs').click(); await ui.page.locator('#history-search').focus();
  await until(() => ui.page.locator('#connection-label').innerText(), value => value === 'Running locally');
  assert.equal(await ui.page.locator('#history-search').evaluate(element => document.activeElement === element), true);
  assert.match(await ui.page.locator('#job-sample').textContent(), /Nội dung nguồn tiếng Việt/);
  await ui.page.locator('#history-status').selectOption('paused');
  await ui.page.locator('#no-matches').waitFor({ state: 'visible' });
  assert.equal(await ui.page.locator('#no-matches').innerText(), 'No matching runs.');
  assert.equal(await ui.page.locator('#job-detail').isHidden(), true);
  assert.equal(await ui.page.locator('#history-prev').isDisabled(), true);
});

test('A delayed search response cannot overwrite a newer filter', async () => {
  await ui.page.locator('#history-status').selectOption('');
  let release, captured = false;
  const gate = new Promise(resolve => { release = resolve; });
  const hold = async route => {
    if (new URL(route.request().url()).searchParams.get('search') === 'Nghiên cứu 00') {
      const response = await route.fetch(); captured = true; await gate; await route.fulfill({ response });
    } else await route.continue();
  };
  await ui.page.route('**/api/jobs?**', hold);
  try {
    await ui.page.locator('#history-search').fill('Nghiên cứu 00');
    await until(async () => captured, value => value);
    await ui.page.locator('#history-search').fill('Nghiên cứu 36'); release();
    await until(() => ui.page.locator('#job-name').innerText(), value => value === 'Nghiên cứu 36');
    assert.equal(await ui.page.locator('#job-list button').count(), 1);
  } finally { release(); await ui.page.unroute('**/api/jobs?**', hold); }
});

test('Idle polling skips unchanged details, backs off in hidden tabs and refreshes when visible', async () => {
  const page = await ui.context.newPage(); page.on('pageerror', error => errors.push(error.message));
  let lists = 0, details = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/jobs') lists++;
    else if (/^\/api\/jobs\/[a-z0-9-]+$/.test(path)) details++;
  });
  try {
    await page.clock.install(); await page.goto(origin);
    await until(() => page.locator('#connection-label').innerText(), value => ['Đang chạy cục bộ', 'Running locally'].includes(value));
    assert.equal(lists, 1); assert.equal(details, 1);
    await page.clock.fastForward(12000); assert.equal(lists, 1);
    await page.clock.fastForward(3000); await until(async () => lists, value => value === 2);
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(details, 1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.fastForward(59000); assert.equal(lists, 2);
    await page.clock.fastForward(1000); await until(async () => lists, value => value === 3);
    await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(details, 1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.fastForward(1); await until(async () => lists, value => value === 4);
    assert.equal(details, 1);
  } finally { await page.close(); }
});

test('History controls fit both languages on desktop and mobile', async () => {
  await ui.page.locator('#history-search').fill(''); await ui.page.locator('#history-status').selectOption('');
  await until(() => ui.page.locator('#job-list button').count(), value => value === 15);
  for (const language of ['vi', 'en']) {
    await ui.page.locator(`[data-language="${language}"]`).click();
    for (const width of [320, 375, 414, 768, 1440]) {
      await ui.page.setViewportSize({ width, height: 1000 });
      const dimensions = await ui.page.evaluate(() => ({ width: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('.history-filters input,.history-filters select,.history-pagination button')].map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }) }));
      assert.ok(dimensions.width <= width + 1, `${language}, ${width}`);
      assert.ok(dimensions.controls.every(rect => rect.left >= 0 && rect.right <= width + 1));
      if ([320, 1440].includes(width)) await ui.page.screenshot({ path: join(directory, `${language}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []); console.log('History UI evidence: ' + directory);
});
