import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { projectRoot, testBrowser } from './extension-helpers.mjs';

let browser, page;
before(async () => {
  browser = await testBrowser(); page = await browser.newPage();
  await page.route('https://source.example/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Source</title>' }));
  await page.goto('https://source.example/set?token=secret&utm_source=tracking#part');
});
after(async () => { await browser?.close(); });
async function read(html, mode = 'auto') {
  await page.setContent('<!doctype html><meta charset="utf-8">' + (html.includes('<title>') ? '' : '<title>Source</title>') + html);
  await page.addScriptTag({ path: join(projectRoot, 'extension', 'reader.js') });
  return page.evaluate(mode => CaoCaoReader.read({ mode }), mode);
}

test('Quizlet DOM preserves pairs and multiline answers while excluding hidden content and tracking', async () => {
  const value = await read('<main><h1>Vocabulary</h1><h2>2 thuật ngữ trong học phần này</h2><div class="SetPageTerm-content" data-term-id="term-1"><span class="TermText">First term</span><span class="TermText">Dòng một<br>Dòng hai<span hidden>PRIVATE</span></span></div><div class="SetPageTerm-content" data-term-id="term-2"><span class="TermText">Second term</span><span class="TermText">Definition</span></div><div class="SetPageTerm-content" hidden><span class="TermText">HIDDEN</span><span class="TermText">HIDDEN</span></div><input value="input-secret"><script type="application/json">{"secret":"script-secret"}</script></main>');
  assert.equal(value.kind, 'question'); assert.equal(value.source.adapter, 'quizlet');
  assert.equal(value.records.length, 2); assert.equal(value.records[0].answer, 'Dòng một\nDòng hai'); assert.equal(value.records[0].sourceId, 'term-1');
  assert.equal(value.expectedTotal, 2); assert.equal(value.source.url, 'https://source.example/set');
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|HIDDEN|input-secret|script-secret|token=|utm_/);
});
test('Tables, definition lists, question cards and plain lists produce usable records', async () => {
  let value = await read('<main><table><thead><tr><th>Term</th><th>Answer</th></tr></thead><tbody><tr><td>Alpha</td><td>First</td></tr><tr><td>Beta</td><td>Second</td></tr></tbody></table></main>');
  assert.equal(value.source.adapter, 'table'); assert.deepEqual(value.records.map(row => [row.body, row.answer]), [['Alpha', 'First'], ['Beta', 'Second']]); assert.equal(value.expectedTotal, null);
  value = await read('<main><dl><dt>One</dt><dd>Definition one</dd><dt>Two</dt><dd>Definition two</dd></dl></main>'); assert.equal(value.records.length, 2);
  value = await read('<main><section class="question-card"><h2>Which option?</h2><p class="option">A. One</p><p class="option">B. Two</p><p class="answer">B</p></section></main>');
  assert.equal(value.records[0].body, 'Which option?'); assert.deepEqual(value.records[0].choices, ['A. One', 'B. Two']); assert.equal(value.records[0].answer, 'B');
  value = await read('<nav><ul><li>Navigation</li></ul></nav><main><ul><li>First item</li><li>Second item</li></ul></main>', 'question'); assert.equal(value.records.length, 2);
});
test('Current Quizlet term-list markup is read without mixing in the standalone flashcard', async () => {
  const term = '<div class="SetPageTermsList-term"><div data-testid="set-page-term-card-side"><span class="TermText">Current term</span></div><div data-testid="set-page-term-card-side"><span class="TermText">Current definition</span></div></div>';
  const value = await read('<main><div data-testid="Card-front"><span class="TermText">Standalone front</span></div><div>Terms in this set (383)</div><section data-testid="terms-list">' + term + term + '</section></main>');
  assert.equal(value.records.length, 2); assert.equal(value.records[0].body, 'Current term'); assert.equal(value.records[0].answer, 'Current definition'); assert.equal(value.expectedTotal, 383);
  assert.notEqual(value.records[0].sourceId, value.records[1].sourceId);
  assert.deepEqual((await page.evaluate(() => CaoCaoReader.read())).records, value.records);
});
test('Article extraction retains visible paragraphs and excludes navigation, forms and hidden sections', async () => {
  const value = await read('<header><p>HEADER PRIVATE</p></header><main><article><h1>Article title</h1><p>A useful paragraph about learning and knowledge.</p><p>Another paragraph with visible content.</p><div style="height:10px"><span hidden>HIDDEN FALLBACK</span></div><p style="display:none">HIDDEN</p><form><p>FORM PRIVATE</p><input value="secret"></form></article></main><footer><p>FOOTER PRIVATE</p></footer>');
  assert.equal(value.kind, 'article'); assert.equal(value.records.length, 1); assert.match(value.records[0].body, /A useful paragraph/); assert.equal(value.expectedTotal, 1);
  assert.doesNotMatch(value.records[0].body, /PRIVATE|HIDDEN|secret/);
});
test('Manual challenges and login screens never become captured articles', async () => {
  let value = await read('<title>Chờ một chút…</title><main><h1>Verify you are human</h1></main>'); assert.equal(value.state, 'waiting'); assert.deepEqual(value.records, []);
  value = await read('<title>Access to this page has been denied</title><main>Access denied</main>'); assert.equal(value.state, 'waiting'); assert.equal(value.reason, 'blocked'); assert.deepEqual(value.records, []);
  value = await read('<title>Đăng nhập</title><main><h1>Đăng nhập</h1><input type="password" value="secret"></main>'); assert.equal(value.state, 'login'); assert.deepEqual(value.records, []);
});
test('Bounded loading selects same-site pagination and leaves unrelated controls alone', async () => {
  await read('<main><div id="result"></div><a href="https://outside.example/" rel="next">Next</a><form><button onclick="window.wrong=true;return false">Next</button></form><nav><button id="more" onclick="document.querySelector(\'#result\').textContent=\'loaded\';this.disabled=true">Xem thêm</button></nav></main>');
  let result = await page.evaluate(() => CaoCaoReader.advance()); assert.equal(result.action, 'next'); assert.equal(await page.locator('#result').textContent(), 'loaded'); assert.equal(await page.evaluate(() => window.wrong), undefined);
  result = await page.evaluate(() => CaoCaoReader.advance()); assert.notEqual(result.action, 'next'); assert.equal(new URL(page.url()).hostname, 'source.example');
  await read('<main><button onclick="window.wrong=true">Next</button><button onclick="window.loaded=true">Show more</button></main>');
  await page.evaluate(() => CaoCaoReader.advance()); assert.equal(await page.evaluate(() => window.loaded), true); assert.equal(await page.evaluate(() => window.wrong), undefined);
});
test('Scrolling can expose virtualized content; an empty region stays empty', async () => {
  let value = await read('<main><div id="scroller" style="width:400px;height:200px;overflow:auto"><div style="height:1000px"><div class="flashcard"><h2>Before scrolling</h2><p class="answer">First</p></div></div></div></main>'); assert.equal(value.records[0].body, 'Before scrolling');
  await page.evaluate(() => document.querySelector('#scroller').addEventListener('scroll', () => { document.querySelector('.flashcard h2').textContent = 'After scrolling'; }));
  assert.equal((await page.evaluate(() => CaoCaoReader.advance())).moved, true);
  value = await page.evaluate(() => CaoCaoReader.read()); assert.equal(value.records[0].body, 'After scrolling');
  value = await read('<main><p hidden>Private hidden content</p></main>', 'question'); assert.deepEqual(value.records, []); assert.equal(value.state, 'empty');
});
