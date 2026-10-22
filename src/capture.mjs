import { createHash, randomUUID } from 'node:crypto';
import { MessageError } from './messages.mjs';

export const CAPTURE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, records: 5000, ttlMs: 24 * 60 * 60 * 1000 });
const hash = value => createHash('sha256').update(value).digest('hex');
function text(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit) throw new MessageError('learning.captureInvalid');
  const result = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  if (required && !result) throw new MessageError('learning.captureInvalid');
  return result;
}
export function captureUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new MessageError('learning.captureInvalid'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new MessageError('learning.captureInvalid');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(fbclid|gclid|funnelUUID)$|token|auth|secret|password|session|signature|^x-amz-|^cf_|^code$|^key$|api.?key/i.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}
export function normalizeCapture(input) {
  if (!input || !['article', 'question'].includes(input.kind) || !Array.isArray(input.records) || !input.records.length) throw new MessageError('learning.captureInvalid');
  if (input.records.length > CAPTURE_LIMITS.records || Buffer.byteLength(JSON.stringify(input)) > CAPTURE_LIMITS.bytes) throw new MessageError('learning.captureLimit');
  const url = captureUrl(input.source?.url), origin = new URL(url).origin, seen = new Set(), records = [];
  for (const raw of input.records) {
    const body = text(raw?.body, 2 * 1024 * 1024, true), answer = text(raw.answer ?? '', 200000);
    const choices = raw.choices ?? [];
    if (!Array.isArray(choices) || choices.length > 100) throw new MessageError('learning.captureInvalid');
    const normalizedChoices = choices.map(value => text(value, 20000));
    const recordUrl = captureUrl(raw.url || url, url);
    if (new URL(recordUrl).origin !== origin) throw new MessageError('learning.captureInvalid');
    const sourceId = raw.sourceId ? text(raw.sourceId, 500, true) : hash(JSON.stringify([body, answer, normalizedChoices]));
    const identity = input.kind === 'question' ? sourceId : recordUrl;
    if (seen.has(identity)) continue;
    seen.add(identity);
    records.push({ title: text(raw.title || body.slice(0, 160), 300, true), body, answer, choices: normalizedChoices, sourceId, url: recordUrl, author: text(raw.author ?? '', 300), publishedAt: text(raw.publishedAt ?? '', 100), files: [] });
  }
  const expectedTotal = input.expectedTotal == null ? null : input.expectedTotal;
  if (expectedTotal !== null && (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || expectedTotal > 100000000)) throw new MessageError('learning.captureInvalid');
  const completeness = input.truncated ? 'partial' : expectedTotal !== null ? (records.length === expectedTotal ? 'complete' : 'partial') : input.kind === 'article' && records.length === 1 && input.completeness === 'complete' ? 'complete' : 'unknown';
  return { kind: input.kind, source: { url, title: text(input.source?.title || records[0].title, 300), adapter: ['quizlet', 'table', 'list', 'article', 'questions'].includes(input.source?.adapter) ? input.source.adapter : 'article' }, records, expectedTotal, completeness, capturedAt: new Date().toISOString() };
}
export function initCaptureStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS browser_captures(id TEXT PRIMARY KEY,payload TEXT NOT NULL,created_at TEXT NOT NULL,expires_at INTEGER NOT NULL,import_id TEXT REFERENCES imports(id))');
}
function captureRow(library, id) {
  if (typeof id !== 'string') throw new MessageError('learning.captureMissing');
  const row = library.db.prepare('SELECT * FROM browser_captures WHERE id=?').get(id);
  if (!row) throw new MessageError('learning.captureMissing');
  if (!row.import_id && row.expires_at < Date.now()) throw new MessageError('learning.captureExpired');
  return row;
}
export function capturedPreview(library, id) {
  const row = captureRow(library, id), value = JSON.parse(row.payload);
  return { id: row.id, expiresAt: new Date(row.expires_at).toISOString(), kind: value.kind, source: value.source, count: value.records.length, expectedTotal: value.expectedTotal, completeness: value.completeness, sample: value.records.slice(0, 3).map(record => ({ ...record, body: record.body.slice(0, 3000), answer: record.answer.slice(0, 3000), choices: record.choices.slice(0, 12).map(choice => choice.slice(0, 1000)) })), importId: row.import_id || null };
}
export function createCapturedPreview(library, input) {
  const value = normalizeCapture(input);
  library.db.prepare('DELETE FROM browser_captures WHERE expires_at<?').run(Date.now());
  const clientId = input.captureId;
  if (clientId !== undefined && (typeof clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(clientId))) throw new MessageError('learning.captureInvalid');
  if (clientId) {
    const previous = library.db.prepare('SELECT payload FROM browser_captures WHERE id=?').get(clientId);
    if (previous) {
      const stored = JSON.parse(previous.payload);
      if (JSON.stringify({ ...stored, capturedAt: null }) !== JSON.stringify({ ...value, capturedAt: null })) throw new MessageError('learning.previewChanged');
      return capturedPreview(library, clientId);
    }
  }
  if (library.db.prepare('SELECT count(*) n FROM browser_captures WHERE import_id IS NULL').get().n >= 8) throw new MessageError('learning.captureCapacity');
  const id = clientId || randomUUID();
  library.db.prepare('INSERT INTO browser_captures(id,payload,created_at,expires_at) VALUES(?,?,?,?)').run(id, JSON.stringify(value), new Date().toISOString(), Date.now() + CAPTURE_LIMITS.ttlMs);
  return capturedPreview(library, id);
}
export function importCapturedPreview(library, input) {
  const row = captureRow(library, input?.id);
  if (row.import_id) {
    const run = library.db.prepare('SELECT id,status FROM imports WHERE id=?').get(row.import_id);
    return { ...run, duplicate: true };
  }
  const value = JSON.parse(row.payload), collectionId = library.collection(input.collectionId);
  const config = { kind: value.kind, url: value.source.url, capturedRecords: value.records, collectionId, downloadFiles: false, summary: { title: value.source.title, count: value.records.length, method: 'extension', completeness: value.completeness, expectedTotal: value.expectedTotal } };
  const id = randomUUID();
  library.transaction(() => {
    library.db.prepare("INSERT INTO imports(id,config,status,created_at,token) VALUES(?,?,'queued',?,?)").run(id, JSON.stringify(config), new Date().toISOString(), 'capture:' + row.id);
    library.db.prepare('UPDATE browser_captures SET import_id=? WHERE id=?').run(id, row.id);
  });
  library.kick();
  return { id, status: 'queued' };
}
