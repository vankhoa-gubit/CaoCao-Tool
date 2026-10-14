import { msg, MessageError, errorMessage, fields } from './messages.mjs';
import { mkdir, readdir, readFile, writeFile, rename, stat, open, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeConfig, initialState, buildRequest, nextState, getAt, httpUrl, fieldPaths } from './config.mjs';
import { fetchJson, retryFetch, wait } from './net.mjs';
import { runBrowser } from './browser.mjs';
import { collectionMetadata } from './detect.mjs';
import { DiskKeyIndex } from './key-index.mjs';
import { FileQueue } from './file-queue.mjs';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const hash = value => createHash('sha256').update(value).digest('hex');

function smallSample(value, depth = 0) {
  if (typeof value === 'string') return value.length > 3000 ? value.slice(0, 3000) + '…' : value;
  if (depth > 5 && value && typeof value === 'object') return '[Xem đầy đủ trong file dữ liệu]';
  if (Array.isArray(value)) return value.slice(0, 15).map(item => smallSample(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, smallSample(item, depth + 1)]));
  return value;
}

export async function atomicJson(target, value) {
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flush: true });
  await rename(temp, target);
}

export function sealPage(page) {
  const { integrity, ...payload } = page;
  return { ...payload, integrity: hash(canonical(payload)) };
}
export function checkPage(page) {
  if (page.integrity && sealPage(page).integrity !== page.integrity) throw new MessageError('checkpoint.pages');
  return page;
}

async function pageFiles(directory) {
  return (await readdir(join(directory, 'pages'))).filter(name => /^\d+\.json$/.test(name)).sort();
}

function itemKey(item, uniqueKey) {
  const key = uniqueKey ? getAt(item, uniqueKey) : undefined;
  if (uniqueKey && key === undefined) throw new MessageError('record.key', { key: uniqueKey });
  return hash(uniqueKey ? canonical([uniqueKey, key]) : canonical(item));
}

async function downloadFiles(job, items, signal, suppliedUrls) {
  if (!job.config.download.enabled) return { files: [], errors: [] };
  const errors = [];
  const urls = new Set(suppliedUrls || []);
  for (const item of items) for (const path of job.config.download.paths) {
    const value = getAt(item, path);
    for (const candidate of Array.isArray(value) ? value.flat(2) : [value]) {
      if (typeof candidate === 'string' && /^(https?:\/\/|\/)/.test(candidate)) {
        try { urls.add(httpUrl(candidate, job.config.request.url).href); }
        catch (error) { errors.push({ url: candidate, errorMessage: errorMessage(error) }); }
      }
    }
  }
  const result = [];
  for (const url of urls) {
    signal.throwIfAborted();
    const extension = extname(new URL(url).pathname).toLowerCase();
    const name = `${hash(url).slice(0, 32)}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.bin'}`;
    const target = join(job.directory, 'files', name), temp = `${target}.part`;
    try { await stat(target); result.push({ url, file: `files/${name}` }); continue; } catch { /* Not downloaded yet. */ }
    const sameOrigin = httpUrl(url).origin === httpUrl(job.config.request.url).origin;
    try { await retryFetch({ url, headers: sameOrigin ? job.config.request.headers : {}, method: 'GET' }, job.config.limits, signal, () => job.log(msg('download.retry')), async response => {
      const handle = await open(temp, 'w');
      let bytes = 0;
      try {
        for await (const chunk of response.body || []) {
          signal.throwIfAborted(); bytes += chunk.length;
          if (bytes > job.config.download.maxFileBytes) throw new MessageError('download.tooLarge');
          await handle.writeFile(chunk);
        }
        await handle.sync();
      } finally { await handle.close(); }
      await rename(temp, target);
    }); } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      signal.throwIfAborted();
      const detail = errorMessage(error); errors.push({ url, errorMessage: detail });
      job.log(msg('download.failed', { url, error: detail })); continue;
    }
    result.push({ url, file: `files/${name}` });
    job.log(msg('download.saved', { name }));
  }
  return { files: result, errors };
}

export function completionEvidence(config, response, next) {
  if (next !== null) return null;
  const p = config.pagination, end = p.mode === 'batch' ? p.batch : p;
  if (end.hasMorePath && getAt(response, end.hasMorePath) === false) return { type: 'sourceEnd', path: end.hasMorePath };
  if ((p.mode === 'batch' || ['cursor', 'nextUrl'].includes(p.mode)) && end.nextPath) {
    const value = getAt(response, end.nextPath);
    if (value === null || value === '') return { type: 'sourceEnd', path: end.nextPath };
  }
  return null;
}

export class Job {
  constructor(manager, config, id, snapshot) {
    this.manager = manager; this.config = config; this.id = id;
    this.configHash = hash(canonical(config));
    this.directory = join(manager.directory, id);
    this.createdAt = snapshot?.createdAt || new Date().toISOString();
    this.status = snapshot?.status || 'paused'; this.state = snapshot && Object.hasOwn(snapshot, 'state') ? snapshot.state : initialState(config);
    this.progress = snapshot?.progress ? { ...snapshot.progress } : { pages: 0, items: 0, duplicates: 0, files: 0, requests: 0, elapsedMs: 0, ...fields(msg('job.ready'), 'stage'), position: null, total: config.kind === 'browser' ? config.source?.total ?? null : null };
    this.logs = snapshot?.logs || []; this.error = snapshot?.error || null;
    this.errorMessage = snapshot?.errorMessage || null;
    this.updatedAt = snapshot?.updatedAt;
    this.hasMore = snapshot?.hasMore;
    this.completionEvidence = snapshot?.completionEvidence || null;
    this.progress.fileErrors ??= 0;
    this.keys = new DiskKeyIndex(join(this.directory, 'keys.sqlite')); this.requestHashes = new Set(); this.responseHashes = [];
    this.keysLoaded = false;
    this.samples = snapshot?.samples || []; this.promise = null; this.controller = null;
    this.exportTasks = new Map();
    this.metadataWrites = Promise.resolve();
    this.fileBase = { files: 0, errors: 0 };
    this.fileQueue = new FileQueue(this.directory, async (index, urls, signal) => {
      const result = await downloadFiles(this, [], signal, urls);
      const path = join(this.directory, 'pages', `${String(index).padStart(8, '0')}.json`);
      const page = checkPage(JSON.parse(await readFile(path, 'utf8')));
      await atomicJson(path, sealPage({ ...page, files: result.files, fileErrors: [...(page.fileDiscoveryErrors || []), ...result.errors] }));
      return result;
    }, async counts => {
      this.syncFileCounts(counts);
      await this.persist();
    });
  }
  syncFileCounts(counts = this.fileQueue.counts()) {
    this.progress.files = this.fileBase.files + (counts?.files || 0);
    this.progress.fileErrors = this.fileBase.errors + (counts?.errors || 0);
    this.progress.filePending = counts?.pending || 0;
  }
  log(message) { this.logs.push({ at: new Date().toISOString(), ...fields(message) }); if (this.logs.length > 100) this.logs.shift(); }
  setStage(message) { Object.assign(this.progress, fields(message, 'stage')); }
  setError(message) { if (message == null) { this.error = null; this.errorMessage = null; } else Object.assign(this, fields(message, 'error')); }
  summary({ detail = true } = {}) {
    return { id: this.id, sourceId: this.config.sourceId || null, queueId: this.config.queueId || null, name: this.config.name, kind: this.config.kind || 'api', status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt || this.createdAt, error: this.error, errorMessage: this.errorMessage, progress: { ...this.progress, elapsedMs: this.progress.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0) }, ...(detail ? { logs: this.logs, samples: smallSample(this.samples), outputPath: this.directory } : {}) };
  }
  async persist() {
    const operation = this.metadataWrites.then(async () => {
    this.updatedAt = new Date().toISOString();
    const metadata = JSON.parse(JSON.stringify({ ...this.summary(), state: this.state, checkpointPage: this.progress.pages, progress: this.progress, hasMore: this.hasMore, completionEvidence: this.completionEvidence, formatVersion: 2, configHash: this.configHash }));
    await atomicJson(join(this.directory, 'checkpoint.json'), { ...metadata, metadataHash: hash(canonical(metadata)) });
    });
    this.metadataWrites = operation.catch(() => {}); return operation;
  }
  async restore(snapshot) {
    const files = await pageFiles(this.directory);
    const { metadataHash, ...metadata } = snapshot || {};
    this.pageSequenceValid = files.every((file, index) => file === `${String(index + 1).padStart(8, '0')}.json`);
    const sealed = metadata.formatVersion === 2 && metadataHash === hash(canonical(metadata));
    const consistent = sealed && metadata.configHash === this.configHash && metadata.checkpointPage === files.length && metadata.progress?.pages === files.length && this.pageSequenceValid;
    const trusted = this.manager.restoreMode !== 'reconcile' && consistent;
    this.restoreSource = trusted ? 'metadata' : 'pages';
    let last;
    let count = 0, fileCount = 0, fileErrors = 0, declaredTotal = null, hasMore, evidence = null;
    for (const file of trusted ? [] : files) {
      const page = checkPage(JSON.parse(await readFile(join(this.directory, 'pages', file), 'utf8')));
      last = page;
      count += page.items.length; fileCount += page.files?.length || 0;
      fileErrors += page.fileErrors?.length || 0;
      evidence = page.completionEvidence || (page.response && this.config.kind !== 'browser' ? completionEvidence(this.config, page.response, page.nextState) : null) || evidence;
      this.samples = page.items.slice(-3);
      if (this.config.kind !== 'browser' && page.response && this.config.pagination.totalPath) {
        const total = getAt(page.response, this.config.pagination.totalPath);
        if (Number.isSafeInteger(total) && total >= 0) declaredTotal = total;
      }
      if (this.config.kind === 'browser' && this.config.source?.pagination !== 'batch') {
        for (const capture of page.response?.captures || []) {
          const metadata = collectionMetadata(capture.response, capture.itemsPath || this.config.source?.itemsPath || '$');
          if (metadata.total !== null) declaredTotal = metadata.total;
          if (metadata.hasMore !== undefined) hasMore = metadata.hasMore;
        }
      }
    }
    if (!trusted && !consistent) this.state = last ? last.nextState : initialState(this.config);
    else if (snapshot && Object.hasOwn(snapshot, 'state')) this.state = snapshot.state;
    if (trusted) { count = this.progress.items; hasMore = this.hasMore; }
    else { this.progress.pages = files.length; this.progress.items = count; this.progress.files = fileCount; this.progress.fileErrors = fileErrors; this.hasMore = hasMore; this.completionEvidence = evidence; }
    if (declaredTotal !== null) this.progress.total = declaredTotal;
    if (this.status === 'running') { this.status = 'paused'; this.log(msg('job.recovered')); }
    if (this.status === 'completed' && (this.config.pagination.mode !== 'batch' && this.progress.total != null && count < this.progress.total || hasMore === true)) {
      this.status = 'incomplete'; this.state = last?.nextState || initialState(this.config);
      this.setStage(msg('job.incompleteStage'));
      this.setError(this.incompleteMessage()); this.log(msg('job.checked', { error: this.errorMessage }));
    }
    if (!this.pageSequenceValid) { this.status = 'failed'; this.setError(msg('checkpoint.pages')); this.setStage(msg('job.failedStage')); }
    // Reconciliation repairs metadata once. Archived jobs retain no deduplication sets.
    if (!trusted || this.status !== snapshot?.status) await this.persist();
  }
  async hydrateKeys(signal) {
    if (this.keysLoaded) return;
    this.keys.open(); this.keys.clear(); this.requestHashes.clear(); this.responseHashes = [];
    this.fileBase = { files: 0, errors: 0 };
    const files = await pageFiles(this.directory);
    if (files.length !== this.progress.pages || !files.every((file, index) => file === `${String(index + 1).padStart(8, '0')}.json`)) throw new MessageError('checkpoint.pages');
    for (const file of files) {
      signal?.throwIfAborted();
      const page = checkPage(JSON.parse(await readFile(join(this.directory, 'pages', file), 'utf8')));
      this.keys.addMany(page.keys);
      if (Object.hasOwn(page, 'fileUrls')) this.fileBase.errors += page.fileDiscoveryErrors?.length || 0;
      else { this.fileBase.files += page.files?.length || 0; this.fileBase.errors += page.fileErrors?.length || 0; }
      this.fileQueue.enqueue(page.index, page.fileUrls || []);
      if (page.requestHash) this.requestHashes.add(page.requestHash);
      if (page.responseHash) this.responseHashes = [...this.responseHashes.slice(-1), page.responseHash];
    }
    signal?.throwIfAborted(); this.syncFileCounts(); this.keysLoaded = true;
  }
  releaseKeys() {
    this.keys.close(); this.requestHashes.clear(); this.responseHashes = []; this.keysLoaded = false;
  }
  incompleteMessage() {
    const count = String(this.progress.items) + (this.progress.total != null ? `/${this.progress.total}` : '');
    if (this.config.kind !== 'browser' && this.config.pagination.mode === 'offset' && this.config.pagination.start > 0) return msg('job.prefixIncomplete', { count, offset: this.config.pagination.start });
    return msg('job.incomplete', { count });
  }
  async commit(rawItems, response, next, position, details = {}) {
    if (this.config.kind === 'browser' && this.config.source?.pagination !== 'batch') {
      for (const capture of response?.captures || []) {
        const metadata = collectionMetadata(capture.response, capture.itemsPath || this.config.source?.itemsPath || '$');
        if (metadata.total !== null) this.progress.total = metadata.total;
        if (metadata.hasMore !== undefined) this.hasMore = metadata.hasMore;
        if (metadata.hasMore === false) this.completionEvidence = { type: 'sourceEnd', path: metadata.hasMorePath };
      }
    }
    const items = [], keys = [], inPage = new Set();
    let duplicates = 0;
    for (const item of rawItems) {
      const key = itemKey(item, this.config.extract.uniqueKey);
      if (this.keys.has(key) || inPage.has(key)) { duplicates++; continue; }
      inPage.add(key); keys.push(key);
      if (this.config.kind === 'browser' && item && typeof item === 'object') { const { _key, ...record } = item; items.push(record); }
      else items.push(item);
    }
    if (this.config.kind === 'browser' && !items.length) {
      this.state = next; this.progress.position = position; this.progress.duplicates += duplicates;
      await this.persist(); return 0;
    }
    const files = [], fileErrors = [], fileUrls = new Set();
    if (this.config.download.enabled) for (const item of items) for (const path of this.config.download.paths) {
      const value = getAt(item, path);
      for (const candidate of Array.isArray(value) ? value.flat(2) : [value]) if (typeof candidate === 'string' && /^(https?:\/\/|\/)/.test(candidate)) {
        try { fileUrls.add(httpUrl(candidate, this.config.request.url).href); } catch (error) { fileErrors.push({ url: candidate, errorMessage: errorMessage(error) }); }
      }
    }
    const index = this.progress.pages + 1;
    const evidence = this.config.kind === 'browser' ? this.completionEvidence : completionEvidence(this.config, response, next);
    const page = { index, at: new Date().toISOString(), position, items, keys, duplicates, files, fileErrors, fileDiscoveryErrors: fileErrors, fileUrls: [...fileUrls], completionEvidence: evidence, nextState: next, ...details, ...(this.config.saveRaw ? { response } : {}) };
    // A complete page is the durable transaction. Resume can reconstruct a stale checkpoint from it.
    await atomicJson(join(this.directory, 'pages', `${String(index).padStart(8, '0')}.json`), sealPage(page));
    this.keys.addMany(keys);
    if (details.requestHash) this.requestHashes.add(details.requestHash);
    if (details.responseHash) this.responseHashes = [...this.responseHashes.slice(-1), details.responseHash];
    this.state = next; this.progress.pages = index; this.progress.items += items.length;
    this.progress.duplicates += duplicates; this.progress.files += files.length; this.progress.position = position;
    this.progress.fileErrors += fileErrors.length;
    this.fileBase.errors += fileErrors.length;
    if (evidence) this.completionEvidence = evidence;
    this.samples = items.slice(-3); this.log(msg('job.saved', { batch: index, count: items.length, duplicates }));
    await this.persist();
    this.fileQueue.enqueue(index, [...fileUrls]);
    this.progress.filePending = this.fileQueue.counts()?.pending || 0;
    this.fileQueue.kick(this.controller.signal);
    return items.length;
  }
  async runApi(signal) {
    let runPages = 0, runItems = 0;
    while (this.state !== null) {
      signal.throwIfAborted();
      const request = buildRequest(this.config, this.state);
      const requestHash = hash(canonical({ url: request.url, method: request.method, body: request.body ?? null }));
      if (this.requestHashes.has(requestHash)) throw new MessageError('pagination.requestLoop');
      this.setStage(msg('job.apiStage')); this.progress.requests++;
      const response = await fetchJson(request, this.config.limits, signal, (attempt, ms) => { this.progress.requests++; this.log(msg('network.retry', { attempt, delay: ms })); });
      const items = getAt(response, this.config.extract.itemsPath);
      if (!Array.isArray(items)) throw new MessageError('record.array', { path: this.config.extract.itemsPath || '$' });
      const responseHash = hash(canonical(items));
      if (items.length && this.responseHashes.slice(-2).filter(value => value === responseHash).length === 2) throw new MessageError('pagination.responseLoop');
      let next = nextState(this.config, this.state, response, items.length, request.url);
      if (this.state.prefixEnd != null && next && Number(next.value) >= this.state.prefixEnd) next = null;
      if (this.config.pagination.totalPath) this.progress.total = getAt(response, this.config.pagination.totalPath);
      const saved = await this.commit(items, response, next, { engine: 'api', page: this.state.value, batch: this.config.pagination.mode === 'batch' ? this.state.batch : null }, { requestHash, responseHash });
      runPages++; runItems += saved;
      if (next === null) return this.config.pagination.mode !== 'batch' && this.progress.total != null && this.progress.items < this.progress.total ? 'incomplete' : 'end';
      if (runPages >= this.config.limits.maxRequests || this.config.limits.maxItems && runItems >= this.config.limits.maxItems) return 'limited';
      await wait(this.config.limits.delayMs, signal);
    }
    return 'end';
  }
  start(reservation, options) {
    if (this.promise) throw new MessageError('job.running');
    if (this.status === 'completed') throw new MessageError('job.completed');
    if (this.pageSequenceValid === false) throw new MessageError('checkpoint.pages');
    this.manager.admit(this, reservation, options);
    const previousStatus = this.status;
    this.controller = new AbortController(); this.status = 'running'; this.setError(null); this.startedAt = Date.now();
    this.log(msg('job.started'));
    this.promise = (async () => {
      try {
        await this.hydrateKeys(this.controller.signal);
        if (this.config.kind !== 'browser' && this.state === null) {
          this.state = initialState(this.config);
          if (previousStatus === 'incomplete' && this.config.pagination.mode === 'offset' && this.config.pagination.start > 0) {
            this.state = { ...this.state, value: 0, prefixEnd: this.config.pagination.start };
            this.log(msg('job.prefixRecovery', { offset: this.config.pagination.start }));
          } else { this.requestHashes.clear(); this.responseHashes = []; }
        }
        await this.persist();
        this.fileQueue.kick(this.controller.signal);
        const reason = this.config.kind === 'browser' ? await runBrowser(this, this.manager.sessions, this.controller.signal) : await this.runApi(this.controller.signal);
        await this.fileQueue.finish(this.controller.signal);
        this.status = reason === 'limited' ? 'limited' : reason === 'incomplete' ? 'incomplete' : 'completed';
        if (this.status === 'completed') this.state = null;
        if (this.status === 'incomplete') this.setError(this.incompleteMessage());
        this.setStage(msg(reason === 'limited' ? 'job.limitedStage' : reason === 'incomplete' ? 'job.incompleteStage' : reason === 'idle' ? 'job.idleStage' : 'job.endStage'));
        this.log(this.progress.stageMessage);
      } catch (error) {
        if (this.controller.signal.aborted) { this.status = 'paused'; this.setStage(msg('job.pausedStage')); this.log(this.progress.stageMessage); }
        else { this.status = 'failed'; this.setError(errorMessage(error)); this.setStage(msg('job.failedStage')); this.log(this.errorMessage); }
      } finally {
        this.controller.abort();
        await this.fileQueue.stop();
        this.progress.elapsedMs += Date.now() - this.startedAt; this.startedAt = null;
        try { await this.persist(); }
        catch (error) { this.status = 'failed'; this.setError(msg('checkpoint.failed', { error: errorMessage(error) })); }
        finally { this.promise = null; this.releaseKeys(); this.manager.release(this); }
      }
    })();
    return this.summary();
  }

  retryFiles() {
    if (this.promise) throw new MessageError('job.running');
    this.manager.admit(this); this.controller = new AbortController();
    this.promise = (async () => {
      try { await this.hydrateKeys(this.controller.signal); this.fileQueue.retry(); await this.fileQueue.finish(this.controller.signal); await this.persist(); }
      finally { this.controller.abort(); await this.fileQueue.stop(); this.releaseKeys(); this.promise = null; this.manager.release(this); }
    })();
    this.promise.catch(error => this.setError(errorMessage(error))); return this.summary();
  }
  async pause() { if (this.promise) { this.controller.abort(); await this.promise; } return this.summary(); }
  async *records(files) {
    files ??= await pageFiles(this.directory);
    for (const file of files) { const page = checkPage(JSON.parse(await readFile(join(this.directory, 'pages', file), 'utf8'))); yield* page.items; }
  }
  async export(format) {
    if (!['json', 'jsonl', 'csv'].includes(format)) throw new MessageError('export.format');
    if (this.exportTasks.has(format)) return this.exportTasks.get(format);
    const task = this.generateExport(format).finally(() => this.exportTasks.delete(format));
    this.exportTasks.set(format, task); return task;
  }
  async generateExport(format) {
    const files = await pageFiles(this.directory);
    const target = join(this.directory, 'exports', `data.${format}`), temp = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temp, 'w');
    const write = text => handle.writeFile(text, 'utf8');
    let columns = [];
    try {
      if (format === 'csv') {
        const union = new Set();
        for await (const record of this.records(files)) for (const key of Object.keys(record && typeof record === 'object' && !Array.isArray(record) ? record : { value: record })) union.add(key);
        columns = [...union]; await write('\ufeff' + columns.map(csvValue).join(',') + '\r\n');
      }
      if (format === 'json') await write('[\n');
      let first = true;
      for await (const record of this.records(files)) {
        if (format === 'json') { await write(`${first ? '' : ',\n'}${JSON.stringify(record)}`); first = false; }
        else if (format === 'jsonl') await write(JSON.stringify(record) + '\n');
        else { const row = record && typeof record === 'object' && !Array.isArray(record) ? record : { value: record }; await write(columns.map(column => csvValue(row[column])).join(',') + '\r\n'); }
      }
      if (format === 'json') await write('\n]\n');
    } catch (error) { await handle.close(); await rm(temp, { force: true }); throw error; }
    await handle.close(); await rename(temp, target); return target;
  }
}

export function csvValue(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export class JobManager {
  constructor(directory, sessions, { maxRunning = 2, restoreMode = 'metadata' } = {}) {
    this.directory = directory; this.sessions = sessions; this.jobs = new Map();
    this.maxRunning = maxRunning; this.restoreMode = restoreMode;
    this.slots = new Set(); this.pending = new Set(); this.closing = false;
  }
  admit(owner, reservation, { retainReservation = false } = {}) {
    if (this.closing) throw new MessageError('manager.closed');
    if (reservation && this.slots.has(reservation)) {
      // A multi-stage import owns its slot until both crawl and import finish.
      if (retainReservation) return;
      this.slots.delete(reservation);
    } else if (this.slots.size >= this.maxRunning) throw new MessageError('job.capacity', { limit: this.maxRunning });
    this.slots.add(owner);
  }
  release(owner) { this.slots.delete(owner); }
  track(operation) {
    this.pending.add(operation);
    operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation));
    return operation;
  }
  createAndStart(input) {
    const reservation = Symbol('creating');
    try { this.admit(reservation); } catch (error) { return Promise.reject(error); }
    return this.track((async () => {
      try { const job = await this.create(input); job.start(reservation); return job; }
      finally { this.release(reservation); }
    })());
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    for (const id of await readdir(this.directory)) {
      if (!/^[a-z0-9-]+$/.test(id)) continue;
      try {
        const directory = join(this.directory, id);
        const config = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'));
        let snapshot;
        try { snapshot = JSON.parse(await readFile(join(directory, 'checkpoint.json'), 'utf8')); } catch { /* Recover from committed pages even if checkpoint is absent. */ }
        const job = new Job(this, config, id, snapshot); await job.restore(snapshot); this.jobs.set(id, job);
      } catch (error) { console.error(`Không thể khôi phục tác vụ ${id}: ${error.message}`); }
    }
    return this;
  }
  create(input) { return this.track(this.createJob(input)); }
  async createJob(input) {
    if (this.closing) throw new MessageError('manager.closed');
    const normalized = normalizeConfig(input);
    for (const key of ['sourceId', 'queueId']) if (input[key] != null && (typeof input[key] !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(input[key]))) throw new MessageError('source.invalid');
    const config = { ...normalized, kind: input.kind === 'browser' ? 'browser' : 'api', ...(input.kind === 'browser' ? { source: input.source || null } : {}), ...(input.sourceId ? { sourceId: input.sourceId } : {}), ...(input.queueId ? { queueId: input.queueId } : {}), ...(input.exportFields ? { exportFields: fieldPaths(input.exportFields) } : {}), ...(input.requiredFields ? { requiredFields: fieldPaths(input.requiredFields) } : {}) };
    if (config.kind === 'browser' && config.source) { httpUrl(config.source.origin); if (!config.source.pathname?.startsWith('/') || !['GET', 'POST'].includes(config.source.method)) throw new MessageError('browser.source'); getAt({}, config.source.itemsPath); }
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const job = new Job(this, config, id);
    for (const folder of ['pages', 'files', 'exports']) await mkdir(join(job.directory, folder), { recursive: true });
    await atomicJson(join(job.directory, 'config.json'), config); await job.persist();
    if (this.closing) throw new MessageError('manager.closed');
    this.jobs.set(id, job);
    return job;
  }
  get(id) { const job = this.jobs.get(id); if (!job) throw new MessageError('job.notFound'); return job; }
  list(options) {
    let jobs = [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    if (!options) return jobs.map(job => job.summary());
    const page = Number(options.page ?? 1), limit = Number(options.limit ?? 15);
    const search = String(options.search || '').trim().toLocaleLowerCase(), status = options.status || '';
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || search.length > 200 || status && !['running', 'paused', 'limited', 'incomplete', 'failed', 'completed'].includes(status)) throw new MessageError('history.query');
    jobs = jobs.filter(job => (!options.sourceId || job.config.sourceId === options.sourceId) && (!status || job.status === status) && (!search || `${job.config.name} ${job.id}`.toLocaleLowerCase().includes(search)));
    const total = jobs.length, pages = Math.max(1, Math.ceil(total / limit)), current = Math.min(page, pages);
    return { jobs: jobs.slice((current - 1) * limit, current * limit).map(job => job.summary({ detail: false })), pagination: { page: current, limit, total, pages } };
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      await Promise.allSettled([...this.jobs.values()].map(job => job.pause()));
      await this.sessions.closeAll();
    })();
    return this.closePromise;
  }
}
