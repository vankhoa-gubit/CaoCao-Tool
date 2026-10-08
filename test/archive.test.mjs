import test from 'node:test';
import assert from 'node:assert/strict';
import { importInput } from '../src/import.mjs';

function archive() {
  const items = Array.from({ length: 30 }, (_, i) => ({ questionId: i + 1, position: i + 1, content: `Câu kiểm thử ${i + 1}`, options: [{ id: i + 1, content: 'Mẫu' }], back: { correctOptionIds: [i + 1] } }));
  return { index: 1, at: '2026-10-07T10:08:00.504Z', position: { engine: 'browser', round: 1, pageUrl: 'https://example.test/study/18/learn?mode=flashcard' }, items, nextState: { round: 1, idleCount: 0 }, response: { captures: [{ url: 'https://api.example.test/api/study-sessions', response: { sessionId: 227, totalQuestions: 379, batchSize: 30, initialFlashcards: { items, offset: 0, limit: 30, totalQuestions: 379, hasMore: true, nextOffset: 30 } } }] } };
}

test('Import: nhận diện archive 30/379 và nextOffset từ response lồng, không giả thành payload POST', () => {
  const source = archive(), result = importInput(JSON.stringify(source));
  assert.equal(result.type, 'archive'); assert.equal(result.body, undefined); assert.equal(result.request, undefined);
  assert.equal(result.pageUrl, source.position.pageUrl); assert.equal(result.summary.observedRecords, 30);
  assert.equal(result.summary.total, 379); assert.equal(result.summary.hasMore, true); assert.equal(result.summary.nextOffset, 30);
  assert.equal(result.summary.uniqueKey, 'questionId'); assert.equal(result.sources[0].method, null);
  assert.equal(result.sources[0].itemsPath, 'initialFlashcards.items'); assert.deepEqual(result.sample, source.items.slice(0, 3));
});

test('Import: archive chỉ lưu bản ghi mới vẫn đọc tổng và cụm từ response đầy đủ', () => {
  const source = archive(); source.items = source.items.slice(15);
  const result = importInput(JSON.stringify(source));
  assert.equal(result.summary.observedRecords, 15); assert.equal(result.sources[0].observedRecords, 30);
  assert.equal(result.sources[0].matches, 15); assert.equal(result.summary.total, 379);
});

test('Import: archive không có URL trang vẫn kiểm tra được và không đoán request khởi tạo', () => {
  const source = archive(); delete source.position.pageUrl;
  const result = importInput(JSON.stringify(source));
  assert.equal(result.type, 'archive'); assert.equal(result.pageUrl, null); assert.equal(result.summary.total, 379);
  assert.match(result.notice, /Nhập URL trang nguồn/); assert.equal(result.config, undefined);
});

test('Import: payload items thông thường giữ nguyên nội dung', () => {
  const source = { items: [{ questionId: 1 }] };
  const result = importInput(JSON.stringify(source));
  assert.equal(result.type, 'payload'); assert.deepEqual(result.body, source);
});
