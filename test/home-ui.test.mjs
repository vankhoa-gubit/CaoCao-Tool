import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, listen } from '../src/server.mjs';
import { testBrowser, qaDirectory, removeQaDirectory } from './extension-helpers.mjs';

test('Home downloads, language, bookmarks and library work in a browser without the extension', async () => {
  const directory = await qaDirectory('home-ui-'); let app, browser;
  try {
    app = await createApp({ dataDirectory: directory }); const origin = await listen(app, 0);
    browser = await testBrowser(); const page = await browser.newPage();
    const errors = [], failures = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
    const response = await page.goto(origin);
    assert.equal(response.status(), 200);
    assert.match(response.headers()['content-security-policy'], /script-src 'self'/);
    await page.locator('#reveal-sample').click();
    assert.equal(await page.locator('#sample-answer').isVisible(), true);
    assert.equal(await page.locator('#reveal-sample').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-home-language="en"]').click();
    assert.match(await page.locator('h1').textContent(), /Learn your own way/);
    assert.equal(await page.locator('#reveal-sample').textContent(), 'Hide answer');
    const downloadEvent = page.waitForEvent('download');
    await page.locator('.home-intro a[download]').click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(), 'CaoCao-Extension.zip');
    assert.equal(await download.failure(), null);
    await download.delete();
    for (const language of ['vi', 'en']) {
      await page.locator(`[data-home-language="${language}"]`).click();
      assert.ok((await page.locator('[data-home]').allTextContents()).every(text => text.trim() && text !== 'undefined'));
      for (const width of [320, 375, 414, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `home overflow ${language}/${width}`);
        assert.deepEqual(await page.locator('.site-comparison th, .site-comparison td').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), [], `table overflow ${language}/${width}`);
        assert.deepEqual(await page.locator('a.site-button, .site-nav > a, .site-footer a').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent)), []);
      }
    }
    await page.locator('.site-nav a[href="/app#library"]').click();
    await page.locator('#learning-title').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#library-panel').isVisible(), true);
    assert.equal(await page.locator('#learning-form').isVisible(), true);
    await page.locator('[data-panel="quick"]').click();
    await page.waitForURL(origin + '/app#quick');
    await page.reload();
    await page.locator('#quick-panel').waitFor();
    await page.locator('[data-panel="library"]').click();
    await page.waitForURL(origin + '/app#library');
    const connection = await fetch(origin + '/api/extension/status').then(response => response.json());
    assert.equal(connection.lastSeenAt, null);
    await page.locator('.workspace-extension-link').click();
    await page.waitForFunction(() => document.getElementById('extension-path').value);
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    await page.locator('#setup-language').click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
    for (const language of ['vi', 'en']) {
      if (await page.locator('html').getAttribute('lang') !== language) await page.locator('#setup-language').click();
      assert.ok((await page.locator('[data-setup]').allTextContents()).every(text => text.trim()));
      for (const width of [320, 375, 414, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `setup overflow ${language}/${width}`);
      }
    }
    for (const panel of ['library', 'quick', 'sources', 'data']) {
      await page.goto(origin + '/#' + panel);
      await page.waitForURL(origin + '/app#' + panel);
      await page.locator(`#${panel}-panel`).waitFor();
    }
    assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  } finally { await browser?.close(); await app?.close(); await removeQaDirectory(directory); }
});
