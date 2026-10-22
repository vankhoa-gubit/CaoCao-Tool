import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createApp, listen } from '../src/server.mjs';
import { projectRoot, browserOptions, qaDirectory, removeQaDirectory, until } from './extension-helpers.mjs';

const nativeEnabled = process.platform === 'win32' && process.env.CAOCAO_TEST_NATIVE_REGISTRY === '1';
const registryKey = 'HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.caocao.library';
let directory, profile, app, context, worker, cdp, extensionId, source, popup, snapshot, sentinel, registryBackup = false, registryTouched = false;
const extension = join(projectRoot, 'extension');
const row = (id, body, answer) => `<div class="SetPageTerm-content" data-term-id="${id}"><span class="TermText">${body}</span><span class="TermText">${answer}</span></div>`;
const sourceHtml = `<!doctype html><meta charset="utf-8"><title>Vocabulary QA</title><main><h1>Vocabulary QA</h1><h2>4 thuật ngữ</h2><div id="terms">${row('one', 'First term', 'Định nghĩa một')}${row('two', 'Second term', 'Dòng một<br>Dòng hai')}</div><button id="more">Show more</button></main><script>document.querySelector('#more').addEventListener('click', function(){this.disabled=true;setTimeout(()=>{document.querySelector('#terms').insertAdjacentHTML('beforeend', ${JSON.stringify(row('three', 'Third term', 'Third definition') + row('four', 'Fourth term', 'Fourth definition'))});this.remove()},1400)});</script>`;
async function launch() {
  context = await chromium.launchPersistentContext(profile, { ...await browserOptions(), headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--enable-unsafe-extension-debugging'] });
  await context.route('https://source.example/**', route => route.fulfill({ contentType: 'text/html', body: sourceHtml }));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
  cdp = await context.browser().newBrowserCDPSession();
}
async function openPopup(page, grant = true) {
  await page.bringToFront();
  if (grant) {
    const target = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find(value => value.url === page.url());
    await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
  }
  // Chromium exposes action popups as transient `other` targets. Render the same
  // production popup in an inactive tab after granting activeTab via the action.
  const created = context.waitForEvent('page');
  await worker.evaluate(() => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: false }));
  const view = await created;
  await view.waitForFunction(() => document.querySelector('#active-title')?.textContent);
  return view;
}
async function send(type, payload = {}) {
  const reply = await popup.evaluate(message => chrome.runtime.sendMessage(message), { type, ...payload });
  if (!reply?.ok) throw new Error(reply?.error || 'No extension response');
  return reply.result;
}
async function stored() { return (await worker.evaluate(() => chrome.storage.local.get('capture'))).capture; }
before(async () => {
  directory = await qaDirectory('extension-mv3-'); profile = join(directory, 'profile');
  app = await createApp({ dataDirectory: join(directory, 'thư viện QA'), sessions: { async open() { throw new Error('Captured import must not revisit the website'); }, async closeAll() {} } });
  await listen(app, 0);
  sentinel = app.library.saveRecord({ title: 'Existing article', body: 'Keep this unrelated item', url: 'https://sentinel.example/article' }, { kind: 'article' }, 0);
  if (nativeEnabled) {
    try { execFileSync('reg.exe', ['export', registryKey, join(directory, 'registry.reg'), '/y'], { stdio: 'pipe', windowsHide: true }); registryBackup = true; }
    catch (error) { if (error.status !== 1) throw error; }
    registryTouched = true;
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(projectRoot, 'scripts', 'install-extension.ps1'), '-DataDirectory', join(directory, 'thư viện QA'), '-Browsers', 'Chromium'], { stdio: 'pipe', windowsHide: true });
    const nativeManifest = JSON.parse(await readFile(join(directory, 'thư viện QA', 'native-host', 'com.caocao.library.json'), 'utf8'));
    assert.deepEqual(nativeManifest.allowed_origins.length, 1);
  }
  await launch(); source = context.pages()[0]; await source.goto('https://source.example/quizlet?funnelUUID=tracking');
});
after(async () => {
  try { await context?.close(); await app?.close(); }
  finally {
    if (registryTouched) {
      try { execFileSync('reg.exe', ['delete', registryKey, '/f'], { stdio: 'pipe', windowsHide: true }); } catch (error) { if (error.status !== 1) throw error; }
      if (registryBackup) execFileSync('reg.exe', ['import', join(directory, 'registry.reg')], { stdio: 'pipe', windowsHide: true });
    }
    if (directory) await removeQaDirectory(directory);
  }
});

test('Production MV3 extension requires activeTab, keeps captured rows across popup closure, and resumes bounded loading', { timeout: 45000 }, async () => {
  const tab = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id);
  const denied = await worker.evaluate(async tabId => { try { await chrome.scripting.executeScript({ target: { tabId }, files: ['reader.js'] }); return false; } catch { return true; } }, tab);
  assert.equal(denied, true);
  popup = await openPopup(source);
  await popup.locator('#start').click();
  await until(async () => (await stored())?.records.length >= 2);
  await send('PAUSE');
  const paused = await stored(); assert.equal(paused.state, 'paused'); assert.equal(paused.records.length, 2);
  await popup.close();
  popup = await openPopup(source, false);
  assert.equal((await send('STATE')).count, 2);
  await popup.locator('#language').click(); assert.equal(await popup.locator('h1').textContent(), 'Keep what you want to learn.');
  await send('RESUME');
  snapshot = await until(async () => { const value = await stored(); return value?.state === 'ready' && value; });
  assert.equal(snapshot.records.length, 4); assert.equal(snapshot.expectedTotal, 4); assert.equal(snapshot.completeness, 'complete');
  assert.equal(snapshot.records.find(row => row.sourceId === 'two').answer, 'Dòng một\nDòng hai');
  assert.doesNotMatch(JSON.stringify(snapshot), /funnelUUID|tracking/);
});

test('Actual extension → native host → local bridge saves the reviewed snapshot after its source tab closes', { skip: !nativeEnabled, timeout: 45000 }, async () => {
  await until(async () => { try { return (await send('HEALTH'))?.app === 'cao-cao'; } catch { return false; } });
  const preview = await send('PREVIEW');
  assert.equal(preview.count, 4); assert.equal(app.library.db.prepare('SELECT count(*) n FROM items').get().n, 1);
  if (process.env.CAOCAO_TEST_SCREENSHOT) { await popup.setViewportSize({ width: 420, height: 600 }); await popup.screenshot({ path: process.env.CAOCAO_TEST_SCREENSHOT, fullPage: true }); }
  await popup.locator('.new-collection summary').click(); await popup.locator('#collection-name').fill('Native MV3 QA'); await popup.locator('#collection-form button').click();
  await until(async () => (await popup.locator('#collection option:checked').textContent()) === 'Native MV3 QA');
  await source.evaluate(() => document.querySelectorAll('.TermText').forEach(node => { node.textContent = 'Changed after preview'; }));
  await source.close();
  await popup.locator('#save').click();
  const run = await until(async () => { const state = await send('STATE'); return state?.state === 'saved' && state; });
  assert.equal(app.manager.jobs.size, 0);
  const questions = app.library.list({ kind: 'question' }).items.map(item => app.library.item(item.id));
  assert.equal(questions.length, 4); assert.equal(questions.find(item => item.body === 'Second term').answer, 'Dòng một\nDòng hai');
  const collectionId = Number(await popup.locator('#collection').inputValue());
  assert.ok(questions.every(item => item.collection_id === collectionId));
  assert.equal(app.library.item(sentinel).body, 'Keep this unrelated item');
  const repeated = await send('SAVE', { collectionId: null }); assert.equal(repeated.id, run.importId);
  assert.equal(app.library.db.prepare('SELECT count(*) n FROM imports').get().n, 1);
});

test('A long rendered list can scroll to delayed content without stopping after several unchanged reads', { timeout: 30000 }, async () => {
  if (!source || source.isClosed()) source = await context.newPage();
  await source.goto('https://source.example/long-list');
  await source.setContent(`<main><h2>4 cards</h2><div id="terms">${row('one', 'One', 'First')}${row('two', 'Two', 'Second')}</div><div style="height:6500px"></div></main>`);
  await source.evaluate(html => { window.added = false; addEventListener('scroll', () => { if (scrollY > 5500 && !window.added) { window.added = true; document.querySelector('#terms').insertAdjacentHTML('beforeend', html); } }); }, row('three', 'Three', 'Third') + row('four', 'Four', 'Fourth'));
  await popup?.close(); popup = await openPopup(source);
  await popup.locator('#start').click(); if (await popup.locator('#replace').isVisible()) await popup.locator('#replace-yes').click();
  const value = await until(async () => { const value = await stored(); return value?.state === 'ready' && value; }, 25000);
  assert.equal(value.records.length, 4, JSON.stringify({ count: value.records.length, reason: value.reason, rounds: value.rounds, scroll: await source.evaluate(() => scrollY) })); assert.equal(value.completeness, 'complete'); assert.ok(value.rounds > 8);
});

test('Manual verification pauses collection and the extension continues when accessible content appears', { timeout: 30000 }, async () => {
  if (!source || source.isClosed()) source = await context.newPage();
  await source.goto('https://source.example/challenge');
  await source.setContent('<title>Chờ một chút…</title><main><h1>Verify you are human</h1></main>');
  await popup.close(); popup = await openPopup(source);
  await popup.locator('.options summary').click(); await popup.locator('#auto-more').uncheck();
  await popup.locator('#start').click();
  if (await popup.locator('#replace').isVisible()) await popup.locator('#replace-yes').click();
  await until(async () => (await stored())?.state === 'waiting');
  await source.setContent(`<title>Resolved by user</title><main><h2>3 cards</h2>${row('one', 'Visible term', 'Accessible definition')}${row('two', 'Another term', 'Another definition')}</main>`);
  const value = await until(async () => { const value = await stored(); return value?.state === 'ready' && value; });
  assert.equal(value.records.length, 2); assert.equal(value.expectedTotal, 3); assert.equal(value.completeness, 'partial');
});

test('Browser restart preserves the snapshot and converts interrupted collection into a recoverable pause', { timeout: 30000 }, async () => {
  await send('RESUME'); await until(async () => (await stored())?.state === 'collecting');
  const before = await stored();
  await context.close(); await launch();
  source = context.pages()[0]; await source.goto('https://source.example/reopened');
  popup = await openPopup(source);
  const state = await send('STATE');
  assert.equal(state.count, before.records.length); assert.equal(state.state, 'paused'); assert.equal(state.reason, 'recovered');
  const exported = await send('EXPORT'); assert.deepEqual(exported.records, before.records);
  await send('RESUME');
  await until(async () => ['paused', 'ready'].includes((await stored())?.state));
  assert.equal((await send('STATE')).count, before.records.length);
});
