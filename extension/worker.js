const MAX_ITEMS = 5000, MAX_BYTES = 4 * 1024 * 1024, MAX_ROUNDS = 120;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let capture, loaded, running, port, sequence = 0, mutations = Promise.resolve();
const requests = new Map();

async function load() {
  if (!loaded) loaded = chrome.storage.local.get('capture').then(async value => {
    capture = value.capture || null;
    if (capture && ['collecting', 'waiting', 'login'].includes(capture.state)) { capture.state = 'paused'; capture.reason = 'recovered'; await persist(); }
  });
  await loaded;
}
async function persist() { if (capture) { capture.updatedAt = new Date().toISOString(); await chrome.storage.local.set({ capture }); } }
function summary() {
  if (!capture) return null;
  const { records, ...metadata } = capture;
  return { ...metadata, count: records.length, sample: records.slice(0, 3).map(record => ({ ...record, body: record.body.slice(0, 3000), answer: (record.answer || '').slice(0, 3000), choices: (record.choices || []).slice(0, 12).map(choice => choice.slice(0, 1000)) })) };
}
function native(command, payload = {}) {
  if (!port) {
    port = chrome.runtime.connectNative('com.caocao.library');
    port.onMessage.addListener(message => {
      const pending = requests.get(message.id);
      if (!pending) return;
      requests.delete(message.id); clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error || 'bridgeUnavailable'));
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      port = null;
      for (const pending of requests.values()) { clearTimeout(pending.timer); pending.reject(new Error('bridgeUnavailable')); }
      requests.clear();
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('bridgeUnavailable')); }, 30000);
    requests.set(id, { resolve, reject, timer });
    try { port.postMessage({ id, command, payload }); } catch { requests.delete(id); clearTimeout(timer); reject(new Error('bridgeUnavailable')); }
  });
}
async function readTab(tabId, mode) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('unsupportedPage');
  await chrome.scripting.executeScript({ target: { tabId }, files: ['reader.js', 'content.js'] });
  return chrome.tabs.sendMessage(tabId, { type: 'CAOCAO_READ', options: { mode } });
}
const recordContent = record => JSON.stringify([record.body, record.answer || '', record.choices || []]);
const recordKey = record => record.sourceId || recordContent(record);
function merge(result) {
  if (result.kind && capture.records.length && capture.kind !== result.kind) { capture.reason = 'sourceChanged'; return false; }
  const existing = new Map(capture.records.map(record => [recordKey(record), record]));
  if (result.records?.some(record => record.sourceId && existing.has(record.sourceId) && recordContent(existing.get(record.sourceId)) !== recordContent(record))) { capture.reason = 'sourceChanged'; return false; }
  const metadata = () => JSON.stringify([capture.kind, capture.source, capture.expectedTotal, capture.completeness, capture.truncated]);
  const previous = metadata();
  capture.kind = result.kind || capture.kind;
  capture.source = result.source || capture.source;
  if (result.expectedTotal != null) capture.expectedTotal = result.expectedTotal;
  const seen = new Set(capture.records.map(recordKey));
  let added = 0, bytes = capture.bytes || 0;
  for (const record of result.records || []) {
    const key = recordKey(record);
    if (seen.has(key)) { capture.duplicates++; continue; }
    const size = new TextEncoder().encode(JSON.stringify(record)).length;
    if (capture.records.length >= MAX_ITEMS || bytes + size > MAX_BYTES - 8192) { capture.reason = 'limit'; break; }
    seen.add(key); capture.records.push(record); bytes += size; added++;
  }
  capture.bytes = bytes;
  capture.truncated ||= Boolean(result.truncated);
  capture.completeness = capture.expectedTotal != null && capture.records.length === capture.expectedTotal && !capture.truncated ? 'complete' : capture.expectedTotal != null || capture.truncated ? 'partial' : 'unknown';
  if (added || metadata() !== previous) { capture.snapshotId = crypto.randomUUID(); capture.preview = null; capture.importId = null; }
  return added;
}
async function collect(control) {
  const started = Date.now();
  let idle = 0, waitingSince = 0, advancing = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (control.stopped || running !== control) return;
      const tab = await chrome.tabs.get(capture.tabId);
      if (control.stopped || running !== control) return;
      if (!/^https?:\/\//.test(tab.url || '') || new URL(tab.url).origin !== capture.origin) {
        capture.state = 'login'; capture.reason = 'returnToSource'; await persist();
        waitingSince ||= Date.now();
        if (Date.now() - waitingSince > 15 * 60 * 1000) break;
        round--; await wait(1200); continue;
      }
      let result;
      try { result = control.initial || await readTab(capture.tabId, capture.mode); delete control.initial; }
      catch { if (control.stopped || running !== control) return; capture.state = 'paused'; capture.reason = 'permission'; await persist(); return; }
      if (control.stopped || running !== control) return;
      if (['waiting', 'login'].includes(result.state)) {
        capture.state = result.state; capture.reason = result.reason || result.state; await persist();
        waitingSince ||= Date.now();
        if (Date.now() - waitingSince > 15 * 60 * 1000) break;
        round--; await wait(1200); continue;
      }
      waitingSince = 0;
      capture.state = 'collecting';
      const added = merge(result);
      if (capture.reason === 'sourceChanged') { capture.state = 'paused'; await persist(); return; }
      if (added || advancing) idle = 0; else idle++;
      advancing = false;
      capture.rounds++;
      await persist();
      if (control.stopped || running !== control) return;
      if (capture.reason === 'limit' || capture.truncated) { capture.state = 'limited'; capture.reason = 'limit'; break; }
      if (capture.completeness === 'complete' || capture.kind === 'article' && capture.records.length || !capture.autoMore || idle >= (capture.expectedTotal > capture.records.length ? 8 : 5)) {
        capture.state = capture.records.length ? 'ready' : 'empty';
        capture.reason = capture.completeness === 'complete' ? 'complete' : !capture.autoMore ? 'currentPage' : 'noProgress';
        break;
      }
      if (Date.now() - started > 5 * 60 * 1000) { capture.state = 'limited'; capture.reason = 'timeLimit'; break; }
      try { const action = await chrome.tabs.sendMessage(capture.tabId, { type: 'CAOCAO_ADVANCE' }); advancing = action?.action === 'scroll' && action.moved; } catch { /* Link navigation can close the response channel. */ }
      await wait(900);
    }
    if (control.stopped || running !== control) return;
    if (['collecting', 'waiting', 'login'].includes(capture.state)) { capture.state = 'limited'; capture.reason = 'timeLimit'; }
    await persist();
  } catch {
    if (!control.stopped && running === control) { capture.state = 'paused'; capture.reason = 'tabClosed'; await persist(); }
  } finally { if (running === control) running = null; }
}
async function pause() {
  if (running) running.stopped = true;
  running = null;
  if (capture && ['collecting', 'waiting', 'login'].includes(capture.state)) { capture.state = 'paused'; capture.reason = 'paused'; await persist(); }
}
async function start(input) {
  await pause();
  const tab = await chrome.tabs.get(input.tabId);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('unsupportedPage');
  const initial = await readTab(tab.id, input.mode || 'auto');
  if (port && capture?.preview && !capture.importId) native('discard', { id: capture.preview.id }).catch(() => {});
  capture = { id: crypto.randomUUID(), snapshotId: crypto.randomUUID(), tabId: tab.id, origin: new URL(tab.url).origin, source: initial.source, kind: initial.kind || 'question', mode: ['article', 'question'].includes(input.mode) ? input.mode : 'auto', autoMore: input.autoMore !== false, records: [], expectedTotal: null, completeness: 'unknown', state: 'collecting', reason: '', bytes: 0, rounds: 0, duplicates: 0, truncated: false };
  await persist();
  running = { stopped: false, initial };
  collect(running);
  return summary();
}
async function resume() {
  if (!capture) throw new Error('readFirst');
  if (running) return summary();
  if (capture.state === 'saved') throw new Error('startAgain');
  capture.reason = ''; capture.autoMore = true; capture.state = 'collecting'; await persist();
  running = { stopped: false }; collect(running); return summary();
}
function snapshot() {
  if (!capture?.records.length) throw new Error('readFirst');
  return { captureId: capture.snapshotId, source: capture.source, kind: capture.kind, records: capture.records, expectedTotal: capture.expectedTotal, completeness: capture.completeness, truncated: capture.truncated };
}
async function preview() {
  await pause();
  if (capture?.preview && !capture.importId && Date.parse(capture.preview.expiresAt) < Date.now()) capture.preview = null;
  if (!capture?.preview) { const input = snapshot(), result = await native('preview', input); if (capture.snapshotId !== input.captureId) throw new Error('readFirst'); capture.preview = result; await persist(); }
  return capture.preview;
}
async function handle(message) {
  await load();
  switch (message.type) {
    case 'STATE': return summary();
    case 'START': return start(message);
    case 'PAUSE': await pause(); return summary();
    case 'RESUME': return resume();
    case 'FOCUS': if (capture) { const tab = await chrome.tabs.get(capture.tabId); await chrome.windows.update(tab.windowId, { focused: true }); await chrome.tabs.update(tab.id, { active: true }); } return summary();
    case 'HEALTH': return native('health');
    case 'PREVIEW': return preview();
    case 'SAVE': {
      const viewed = await preview();
      const result = await native('import', { id: viewed.id, collectionId: message.collectionId });
      capture.importId = result.id; capture.state = 'saving'; await persist(); return result;
    }
    case 'IMPORT_STATUS': {
      if (!capture?.importId) return null;
      const result = await native('importStatus', { id: capture.importId });
      if (result.status === 'completed') { capture.state = 'saved'; await persist(); }
      return result;
    }
    case 'COLLECTION': return native('createCollection', { name: message.name });
    case 'EXPORT': return snapshot();
    default: throw new Error('invalidCommand');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  const mutate = ['START', 'PAUSE', 'RESUME', 'PREVIEW', 'SAVE'].includes(message.type);
  const result = mutate ? mutations.then(() => handle(message)) : handle(message);
  if (mutate) mutations = result.catch(() => {});
  result.then(result => respond({ ok: true, result }), error => respond({ ok: false, error: error.message || 'readFailed' }));
  return true;
});
