import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translations, translate, translateMessage, localeFor } from '../public/i18n.js';
import { normalizeConfig } from '../src/config.mjs';
import { importInput } from '../src/import.mjs';

test('Every translatable HTML label has Vietnamese and English text', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const [, key] of html.matchAll(/data-i18n(?:-aria-label|-placeholder)?="([^"]+)"/g)) {
    assert.ok(translations.vi[key], `Missing Vietnamese: ${key}`);
    assert.ok(translations.en[key], `Missing English: ${key}`);
  }
  assert.equal(translate('en', 'report.sourceCounts', { path: 'data.items', count: '1,234' }), 'data.items — 1,234 found');
  assert.equal(translate('vi', 'report.sourceCounts', { path: 'data.items', count: '1.234' }), 'data.items — 1.234 đã thấy');
  assert.equal(localeFor('en'), 'en-US');
  assert.equal(localeFor('unsupported'), 'vi-VN');
});

test('English translates actual backend validation errors, including dynamic bounds', () => {
  const cases = [
    [{ request: { url: 'not a URL' } }, 'Invalid URL. Enter a complete URL starting with http:// or https://.'],
    [{ request: { url: 'http://localhost/api', method: 'DELETE' } }, 'Data collection supports GET and POST.'],
    [{ request: { url: 'http://localhost/api' }, limits: { delayMs: -1 } }, 'Delay must be an integer from 0 to 60000.'],
    [{ request: { url: 'http://localhost/api' }, pagination: { mode: 'cursor', nextPath: '' } }, 'Enter the next cursor/URL path in the response.'],
  ];
  for (const [config, expected] of cases) {
    let error;
    try { normalizeConfig(config); } catch (caught) { error = caught; }
    assert.ok(error);
    assert.equal(translateMessage(error.message, 'en'), expected);
    assert.equal(translateMessage(error.message, 'vi'), error.message);
  }
  let error;
  try { importInput('curl https://example.com --unsupported'); } catch (caught) { error = caught; }
  assert.equal(translateMessage(error.message, 'en'), 'Unsupported cURL option --unsupported. Use a request from Copy as cURL (bash).');
});

test('Archive notices translate all combinations of remaining data and source URL', () => {
  for (const hasMore of [true, false]) {
    for (const hasUrl of [true, false]) {
      const records = [{ questionId: 1, content: 'Nội dung nguồn giữ nguyên' }];
      const result = importInput(JSON.stringify({ items: records, position: hasUrl ? { pageUrl: 'https://example.com/study' } : {}, response: { captures: [{ url: 'https://example.com/api', response: { data: { items: records, totalQuestions: 9, hasMore, nextOffset: 1 } } }] } }));
      const english = translateMessage(result.notice, 'en');
      assert.match(english, /^Read saved data file: 1\/9 records\./);
      assert.equal(english.includes('The source has more batches.'), hasMore);
      assert.equal(english.includes('Rescanning the URL'), hasUrl);
      assert.deepEqual(result.sample, records);
    }
  }
});

test('Recovery errors and progress templates keep source identifiers intact', () => {
  const incomplete = 'Đã lưu 30/379 bản ghi. Lượt tải bắt đầu ở offset 60; bấm Chạy tiếp để tải bù phần đầu bị bỏ sót.';
  assert.equal(translateMessage('Đã kiểm tra dữ liệu cũ: ' + incomplete, 'en'), 'Checked saved data: Saved 30/379 records. The run started at offset 60; select Resume to collect the missing beginning.');
  assert.equal(translateMessage('Đã lưu cụm 2: 30 bản ghi mới, 4 bản ghi trùng.', 'en'), 'Saved batch 2: 30 new records, 4 duplicates.');
  assert.equal(translateMessage('Đã lưu 30/379 bản ghi; đang chuyển câu để tải cụm tiếp theo', 'en'), 'Saved 30/379 records; moving between questions to load the next batch');
  assert.equal(translateMessage('Đã tải file tên-file-ảnh.txt.', 'en'), 'Downloaded file tên-file-ảnh.txt.');
  assert.equal(translateMessage('Unexpected upstream error: dữ liệu nguồn', 'en'), 'Unexpected upstream error: dữ liệu nguồn');
});
