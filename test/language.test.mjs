import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, listen, projectRoot } from '../src/server.mjs';
import { BrowserSessions } from '../src/browser.mjs';
import { storageKey } from '../public/i18n.js';

let app, origin, directory, ui, observedReport;
const browserErrors = [];
const languageButton = language => ui.page.locator(`[data-language="${language}"]`);
async function until(read, condition, timeout = 60000) {
  const start = Date.now();
  while (true) {
    const value = await read();
    if (condition(value)) return value;
    if (Date.now() - start > timeout) throw new Error('Expected state was not reached.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
before(async () => {
  await mkdir(join(projectRoot, '.qa'), { recursive: true });
  directory = await mkdtemp(join(projectRoot, '.qa', 'language-'));
  await mkdir(join(directory, 'screenshots'));
  app = await createApp({ dataDirectory: directory, scanOptions: { rounds: 1, waitMs: 300 } });
  origin = await listen(app, 0);
  ui = await new BrowserSessions(join(directory, 'ui-session')).open(origin);
  ui.page.on('pageerror', error => browserErrors.push(error.message));
});
after(async () => { await ui?.close(); await app?.close(); });

test('Language buttons work by keyboard and preserve entered data', async () => {
  await ui.page.goto(origin);
  assert.equal(await ui.page.locator('html').getAttribute('lang'), 'vi');
  assert.equal(await languageButton('vi').getAttribute('aria-pressed'), 'true');
  await ui.page.locator('#site-url').fill(origin + '/demo/infinite');
  await ui.page.locator('#advanced').evaluate(element => { element.open = true; });
  await ui.page.locator('#import-text').fill('Dữ liệu do người dùng nhập');
  const config = await ui.page.locator('#config-editor').inputValue();
  await languageButton('en').focus();
  await ui.page.keyboard.press('Enter');
  assert.equal(await ui.page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await ui.page.title(), 'Cào Cào · Download web data');
  assert.equal(await languageButton('en').getAttribute('aria-pressed'), 'true');
  assert.equal(await languageButton('vi').getAttribute('aria-pressed'), 'false');
  assert.equal(await ui.page.locator('.language-switch').getAttribute('aria-label'), 'Choose language');
  assert.equal(await ui.page.locator('#job-progress').getAttribute('aria-label'), 'Data collection progress');
  assert.equal(await ui.page.locator('#site-url').inputValue(), origin + '/demo/infinite');
  assert.equal(await ui.page.locator('#import-text').inputValue(), 'Dữ liệu do người dùng nhập');
  assert.equal(await ui.page.locator('#config-editor').inputValue(), config);
  assert.equal(await ui.page.locator('#advanced').getAttribute('open'), '');
  assert.equal(await languageButton('en').evaluate(element => document.activeElement === element), true);
});

test('Language preference survives reload and unsupported values fall back to Vietnamese', async () => {
  await ui.page.reload();
  assert.equal(await ui.page.locator('html').getAttribute('lang'), 'en');
  assert.equal(await ui.page.locator('#scan-button').innerText(), 'Analyze page ↗');
  await ui.page.evaluate(key => localStorage.setItem(key, 'unsupported'), storageKey);
  await ui.page.reload();
  assert.equal(await ui.page.locator('html').getAttribute('lang'), 'vi');
  assert.equal(await languageButton('vi').getAttribute('aria-pressed'), 'true');
});

test('Language changes in another tab update the current tab without resetting input', async () => {
  const otherPage = await ui.context.newPage();
  const input = await ui.page.locator('#config-editor').inputValue();
  try {
    await otherPage.goto(origin);
    await otherPage.locator('[data-language="en"]').click();
    await until(() => ui.page.locator('html').getAttribute('lang'), value => value === 'en');
    assert.equal(await ui.page.locator('#config-editor').inputValue(), input);
    await otherPage.locator('[data-language="vi"]').click();
    await until(() => ui.page.locator('html').getAttribute('lang'), value => value === 'vi');
  } finally { await otherPage.close(); }
});

test('Switch while scanning, retain source options, collect, resume and export in English', { timeout: 90000 }, async () => {
  await ui.page.setViewportSize({ width: 1440, height: 1000 });
  await languageButton('en').click();
  await ui.page.locator('#demo-infinite').click();
  await ui.page.locator('#scan-progress').waitFor({ state: 'visible' });
  assert.equal(await ui.page.locator('#scan-button').isDisabled(), true);
  await languageButton('vi').click();
  assert.equal(await ui.page.locator('#scan-button').isDisabled(), true);
  assert.equal(await ui.page.locator('#site-url').inputValue(), origin + '/demo/infinite');
  await ui.page.locator('#report').waitFor({ state: 'visible', timeout: 60000 });
  assert.equal(app.scans.size, 1);
  observedReport = [...app.scans.values()][0].report;
  await languageButton('en').click();
  assert.equal(await ui.page.locator('#capability').innerText(), 'Well detected');
  assert.equal(await ui.page.locator('#report-pagination').innerText(), 'Pages within batches');
  assert.equal(await ui.page.locator('#report-message').innerText(), 'JSON data found, pagination detected and a test request succeeded.');
  await ui.page.locator('#source-select').selectOption('dom');
  await ui.page.locator('#strategy').selectOption('browser');
  await ui.page.locator('#max-requests').fill('2');
  await ui.page.locator('#download-files').check();
  const sample = await ui.page.locator('#scan-sample').innerText();
  await languageButton('vi').click();
  await languageButton('en').click();
  assert.equal(await ui.page.locator('#source-select').inputValue(), 'dom');
  assert.equal(await ui.page.locator('#strategy').inputValue(), 'browser');
  assert.equal(await ui.page.locator('#max-requests').inputValue(), '2');
  assert.equal(await ui.page.locator('#download-files').isChecked(), true);
  assert.equal(await ui.page.locator('#scan-sample').innerText(), sample);
  await ui.page.locator('#source-select').selectOption('0');
  await ui.page.locator('#strategy').selectOption('auto');
  await ui.page.locator('#download-files').uncheck();
  let releaseStart, starts = 0;
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const holdStart = async route => {
    if (route.request().method() === 'POST') { starts++; await startGate; }
    await route.continue();
  };
  await ui.page.route('**/api/jobs', holdStart);
  try {
    await ui.page.locator('#start-job').click();
    await until(async () => starts, value => value === 1);
    await languageButton('vi').click();
    await languageButton('en').click();
    assert.equal(await ui.page.locator('#start-job').isDisabled(), true);
    assert.equal(starts, 1);
  } finally { releaseStart(); }
  await until(() => ui.page.locator('#job-status').innerText(), value => value === 'Limit reached');
  await ui.page.unroute('**/api/jobs', holdStart);
  assert.equal(await ui.page.locator('#job-stage').innerText(), 'The run limit was reached; you can resume');
  assert.match(await ui.page.locator('#job-log').innerText(), /Saved batch/);
  const job = [...app.manager.jobs.values()][0];
  const rawName = job.config.name;
  await languageButton('vi').click();
  assert.equal(await ui.page.locator('#job-status').innerText(), 'Đạt giới hạn');
  assert.match(await ui.page.locator('#job-log').innerText(), /Đã lưu cụm/);
  assert.equal(await ui.page.locator('#job-name').innerText(), rawName);
  await languageButton('en').click();
  for (let attempt = 0; attempt < 8 && job.status !== 'completed'; attempt++) {
    await ui.page.locator('#resume-job').click();
    await until(() => fetch(origin + '/api/jobs/' + job.id).then(response => response.json()), value => value.status !== 'running');
    await ui.page.locator('#refresh-jobs').click();
    await until(() => ui.page.locator('#job-status').innerText(), value => ['Completed', 'Limit reached'].includes(value));
  }
  await until(() => ui.page.locator('#job-status').innerText(), value => value === 'Completed');
  assert.equal(job.progress.items, 18);
  assert.match(await ui.page.locator('#job-meta').innerText(), /Collected via API.*seconds.*files/);
  const exportUrl = await ui.page.locator('#export-json').getAttribute('href');
  const response = await fetch(origin + exportUrl), records = await response.json();
  assert.equal(records.length, 18);
  assert.equal(new Set(records.map(record => record.id)).size, 18);
  assert.equal(records[0].title, 'Tài liệu mẫu 1');
  assert.equal(await ui.page.locator('#job-name').innerText(), rawName);
  await ui.page.screenshot({ path: join(directory, 'screenshots', 'desktop-en-completed.png'), fullPage: true });
});

test('Validation errors, request previews and archive imports switch without changing data', async () => {
  await ui.page.locator('#advanced').evaluate(element => { element.open = true; });
  await ui.page.locator('#config-editor').fill('{broken JSON');
  await ui.page.locator('#manual-start').click();
  await until(() => ui.page.locator('#notice').innerText(), value => value.startsWith('Invalid JSON configuration.'));
  await languageButton('vi').click();
  assert.match(await ui.page.locator('#notice').innerText(), /^Cấu hình JSON không hợp lệ/);
  await languageButton('en').click();
  const config = structuredClone(observedReport.candidates[0].apiConfig);
  config.limits.delayMs = -1;
  await ui.page.locator('#config-editor').fill(JSON.stringify(config));
  await ui.page.locator('#manual-start').click();
  await until(() => ui.page.locator('#notice').innerText(), value => value === 'Delay must be an integer from 0 to 60000.');
  config.limits.delayMs = 0;
  await ui.page.locator('#config-editor').fill(JSON.stringify(config));
  await ui.page.locator('#preview-button').click();
  await until(() => ui.page.locator('#preview-result').innerText(), value => value.startsWith('Arrays found:'));
  const rawPreview = (await ui.page.locator('#preview-result').innerText()).split('\n\n').slice(1).join('\n\n');
  await languageButton('vi').click();
  assert.match(await ui.page.locator('#preview-result').innerText(), /^Mảng tìm thấy:/);
  assert.equal((await ui.page.locator('#preview-result').innerText()).split('\n\n').slice(1).join('\n\n'), rawPreview);
  await languageButton('en').click();
  const records = [{ questionId: 1, content: 'Câu hỏi tiếng Việt từ nguồn' }];
  const archive = { items: records, response: { captures: [{ url: origin + '/archive', response: { data: { items: records, totalQuestions: 10, hasMore: true, nextOffset: 1 } } }] } };
  await ui.page.locator('#import-file').setInputFiles({ name: 'archive.txt', mimeType: 'text/plain', buffer: Buffer.from(JSON.stringify(archive)) });
  await until(() => ui.page.locator('#preview-result').innerText(), value => value.startsWith('Saved data file:'));
  assert.match(await ui.page.locator('#preview-result').innerText(), /1 \/ 10 records/);
  assert.match(await ui.page.locator('#preview-result').innerText(), /Câu hỏi tiếng Việt từ nguồn/);
  assert.match(await ui.page.locator('#notice').innerText(), /^Read saved data file: 1\/10 records\. The source has more batches\./);
  const configText = await ui.page.locator('#config-editor').inputValue();
  await languageButton('vi').click();
  assert.match(await ui.page.locator('#preview-result').innerText(), /^File dữ liệu đã lưu:/);
  assert.equal(await ui.page.locator('#config-editor').inputValue(), configText);
  assert.equal(await ui.page.locator('#import-text').inputValue(), JSON.stringify(archive));
  await languageButton('en').click();
});

test('Unavailable localStorage and a disconnected server do not break the switch', async () => {
  const context = await ui.browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  try {
    await context.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }); });
    await page.route('**/api/jobs', route => route.abort());
    await page.goto(origin);
    await until(() => page.locator('#connection-label').innerText(), value => value === 'Mất kết nối máy chủ');
    await page.locator('[data-language="en"]').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#connection-label').innerText(), 'Server disconnected');
    await page.locator('[data-language="vi"]').click();
    assert.equal(await page.locator('#connection-label').innerText(), 'Mất kết nối máy chủ');
  } finally { await context.close(); }
});

test('Locale formats large counters while preserving custom names and source text', async () => {
  const context = await ui.browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  try {
    const response = await fetch(origin + '/api/jobs'), data = await response.json();
    const job = { ...data.jobs[0], name: 'Tên tác vụ của người dùng', progress: { ...data.jobs[0].progress, items: 1234, total: 5678 }, samples: [{ text: 'Nội dung nguồn tiếng Việt' }] };
    await page.route('**/api/jobs', route => route.fulfill({ json: { jobs: [job] } }));
    await page.goto(origin);
    await until(() => page.locator('#job-items').innerText(), value => value === '1.234 / 5.678');
    await page.locator('[data-language="en"]').click();
    assert.equal(await page.locator('#job-items').innerText(), '1,234 / 5,678');
    assert.equal(await page.locator('#job-name').innerText(), job.name);
    await page.locator('#job-sample').evaluate(element => { element.closest('details').open = true; });
    assert.match(await page.locator('#job-sample').innerText(), /Nội dung nguồn tiếng Việt/);
  } finally { await context.close(); }
});

test('Both languages fit desktop and mobile layouts without JavaScript errors', async () => {
  for (const language of ['vi', 'en']) {
    await languageButton(language).click();
    for (const width of [320, 375, 414, 768, 1440]) {
      await ui.page.setViewportSize({ width, height: 900 });
      const dimensions = await ui.page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll('button')].filter(button => button.offsetWidth > 0).map(button => ({ text: button.innerText, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })) }));
      assert.ok(dimensions.scroll <= width + 1, `${language} overflows at ${width}px: ${dimensions.scroll}`);
      for (const button of dimensions.buttons) assert.ok(button.left >= 0 && button.right <= width + 1, `${language} button overflows at ${width}px: ${button.text}`);
      assert.equal(await languageButton(language).isVisible(), true);
      if ([320, 1440].includes(width)) await ui.page.screenshot({ path: join(directory, 'screenshots', `${language}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(browserErrors, []);
  console.log(`Language QA evidence: ${directory}`);
});
