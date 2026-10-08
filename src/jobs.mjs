import { mkdir, readdir, readFile, writeFile, rename, stat, open, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeConfig, initialState, buildRequest, nextState, getAt, httpUrl } from './config.mjs';
import { fetchJson, retryFetch, wait } from './net.mjs';
import { runBrowser } from './browser.mjs';
import { collectionMetadata } from './detect.mjs';

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
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
  await rename(temp, target);
}

async function pageFiles(directory) {
  return (await readdir(join(directory, 'pages'))).filter(name => /^\d+\.json$/.test(name)).sort();
}

function itemKey(item, uniqueKey) {
  const key = uniqueKey ? getAt(item, uniqueKey) : undefined;
  if (uniqueKey && key === undefined) throw new Error(`Bản ghi không có khóa ${uniqueKey}. Kiểm tra khóa loại trùng hoặc để trống để so sánh toàn bộ nội dung.`);
  return hash(uniqueKey ? canonical([uniqueKey, key]) : canonical(item));
}

async function downloadFiles(job, items, signal) {
  if (!job.config.download.enabled) return [];
  const urls = new Set();
  for (const item of items) for (const path of job.config.download.paths) {
    const value = getAt(item, path);
    for (const candidate of Array.isArray(value) ? value.flat(2) : [value]) {
      if (typeof candidate === 'string' && /^(https?:\/\/|\/)/.test(candidate)) urls.add(httpUrl(candidate, job.config.request.url).href);
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
    await retryFetch({ url, headers: sameOrigin ? job.config.request.headers : {}, method: 'GET' }, job.config.limits, signal, () => job.log('Đang thử lại việc tải file.'), async response => {
      const handle = await open(temp, 'w');
      let bytes = 0;
      try {
        for await (const chunk of response.body || []) {
          signal.throwIfAborted(); bytes += chunk.length;
          if (bytes > job.config.download.maxFileBytes) throw new Error('File vượt giới hạn kích thước đã cấu hình.');
          await handle.writeFile(chunk);
        }
      } finally { await handle.close(); }
      await rename(temp, target);
    }).catch(async error => { await rm(temp, { force: true }).catch(() => {}); throw error; });
    result.push({ url, file: `files/${name}` });
    job.log(`Đã tải file ${name}.`);
  }
  return result;
}

export class Job {
  constructor(manager, config, id, snapshot) {
    this.manager = manager; this.config = config; this.id = id;
    this.directory = join(manager.directory, id);
    this.createdAt = snapshot?.createdAt || new Date().toISOString();
    this.status = snapshot?.status || 'paused'; this.state = snapshot && Object.hasOwn(snapshot, 'state') ? snapshot.state : initialState(config);
    this.progress = snapshot?.progress || { pages: 0, items: 0, duplicates: 0, files: 0, requests: 0, elapsedMs: 0, stage: 'Sẵn sàng', position: null, total: config.kind === 'browser' ? config.source?.total ?? null : null };
    this.logs = snapshot?.logs || []; this.error = snapshot?.error || null;
    this.keys = new Set(); this.requestHashes = new Set(); this.responseHashes = [];
    this.samples = []; this.promise = null; this.controller = null;
    this.exportTasks = new Map();
  }
  log(message) { this.logs.push({ at: new Date().toISOString(), message }); if (this.logs.length > 100) this.logs.shift(); }
  summary() {
    return { id: this.id, name: this.config.name, kind: this.config.kind || 'api', status: this.status, createdAt: this.createdAt, updatedAt: this.updatedAt || this.createdAt, error: this.error, progress: { ...this.progress, elapsedMs: this.progress.elapsedMs + (this.startedAt ? Date.now() - this.startedAt : 0) }, logs: this.logs, samples: smallSample(this.samples), outputPath: this.directory };
  }
  async persist() {
    this.updatedAt = new Date().toISOString();
    await atomicJson(join(this.directory, 'checkpoint.json'), { ...this.summary(), state: this.state, checkpointPage: this.progress.pages, progress: this.progress });
  }
  async restore(snapshot) {
    const files = await pageFiles(this.directory);
    let last;
    let count = 0, fileCount = 0, declaredTotal = null, hasMore;
    for (const file of files) {
      const page = JSON.parse(await readFile(join(this.directory, 'pages', file), 'utf8'));
      last = page;
      for (const key of page.keys) this.keys.add(key);
      if (page.requestHash) this.requestHashes.add(page.requestHash);
      if (page.responseHash) this.responseHashes.push(page.responseHash);
      count += page.items.length; fileCount += page.files?.length || 0;
      this.samples = page.items.slice(-3);
      if (this.config.kind === 'browser' && this.config.source?.pagination !== 'batch') {
        for (const capture of page.response?.captures || []) {
          const metadata = collectionMetadata(capture.response, capture.itemsPath || this.config.source?.itemsPath || '$');
          if (metadata.total !== null) declaredTotal = metadata.total;
          if (metadata.hasMore !== undefined) hasMore = metadata.hasMore;
        }
      }
    }
    if (files.length > (snapshot?.checkpointPage || 0)) this.state = last.nextState;
    else if (snapshot && Object.hasOwn(snapshot, 'state')) this.state = snapshot.state;
    this.progress.pages = files.length; this.progress.items = count; this.progress.files = fileCount;
    if (declaredTotal !== null) this.progress.total = declaredTotal;
    if (this.status === 'running') { this.status = 'paused'; this.log('Đã khôi phục điểm lưu sau khi máy chủ dừng. Bấm Chạy tiếp để tiếp tục.'); }
    if (this.status === 'completed' && (this.config.pagination.mode !== 'batch' && this.progress.total != null && count < this.progress.total || hasMore === true)) {
      this.status = 'incomplete'; this.state = last?.nextState || initialState(this.config);
      this.progress.stage = 'Chưa tải đủ dữ liệu; có thể chạy tiếp';
      this.error = this.incompleteMessage(); this.log('Đã kiểm tra dữ liệu cũ: ' + this.error);
      await this.persist();
    }
  }
  incompleteMessage() {
    if (this.config.kind !== 'browser' && this.config.pagination.mode === 'offset' && this.config.pagination.start > 0) return `Đã lưu ${this.progress.items}/${this.progress.total} bản ghi. Lượt tải bắt đầu ở offset ${this.config.pagination.start}; bấm Chạy tiếp để tải bù phần đầu bị bỏ sót.`;
    return `Đã lưu ${this.progress.items}` + (this.progress.total != null ? `/${this.progress.total}` : '') + ' bản ghi. Nguồn vẫn còn dữ liệu nhưng chưa tải tiếp được. Có thể chạy tiếp hoặc đăng nhập và quét lại URL.';
  }
  async commit(rawItems, response, next, position, details = {}) {
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
    const files = await downloadFiles(this, items, this.controller.signal);
    const index = this.progress.pages + 1;
    const page = { index, at: new Date().toISOString(), position, items, keys, duplicates, files, nextState: next, ...details, ...(this.config.saveRaw ? { response } : {}) };
    // A complete page is the durable transaction. Resume can reconstruct a stale checkpoint from it.
    await atomicJson(join(this.directory, 'pages', `${String(index).padStart(8, '0')}.json`), page);
    for (const key of keys) this.keys.add(key);
    if (details.requestHash) this.requestHashes.add(details.requestHash);
    if (details.responseHash) this.responseHashes.push(details.responseHash);
    this.state = next; this.progress.pages = index; this.progress.items += items.length;
    this.progress.duplicates += duplicates; this.progress.files += files.length; this.progress.position = position;
    this.samples = items.slice(-3); this.log(`Đã lưu cụm ${index}: ${items.length} bản ghi mới, ${duplicates} bản ghi trùng.`);
    await this.persist(); return items.length;
  }
  async runApi(signal) {
    let runPages = 0, runItems = 0;
    while (this.state !== null) {
      signal.throwIfAborted();
      const request = buildRequest(this.config, this.state);
      const requestHash = hash(canonical({ url: request.url, method: request.method, body: request.body ?? null }));
      if (this.requestHashes.has(requestHash)) throw new Error('Request phân trang đã lặp lại. Tool dừng để tránh vòng lặp.');
      this.progress.stage = 'Đang tải dữ liệu từ API'; this.progress.requests++;
      const response = await fetchJson(request, this.config.limits, signal, (attempt, ms) => { this.progress.requests++; this.log(`Thử lại request lần ${attempt} sau ${ms} ms.`); });
      const items = getAt(response, this.config.extract.itemsPath);
      if (!Array.isArray(items)) throw new Error(`Không tìm thấy mảng bản ghi tại ${this.config.extract.itemsPath || '$'}. Dùng Xem thử để xác định đường dẫn.`);
      const responseHash = hash(canonical(items));
      if (items.length && this.responseHashes.slice(-2).filter(value => value === responseHash).length === 2) throw new Error('Nguồn trả về cùng một trang 3 lần liên tiếp. Kiểm tra tham số phân trang.');
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
  start() {
    if (this.promise) throw new Error('Tác vụ đang chạy.');
    if (this.status === 'completed') throw new Error('Tác vụ đã kết thúc. Tạo lượt mới nếu muốn tải lại.');
    if (this.config.kind !== 'browser' && this.state === null) {
      this.state = initialState(this.config);
      if (this.status === 'incomplete' && this.config.pagination.mode === 'offset' && this.config.pagination.start > 0) {
        this.state = { ...this.state, value: 0, prefixEnd: this.config.pagination.start };
        this.log(`Đang tải bù phần đầu bị bỏ sót: offset 0 đến trước ${this.config.pagination.start}.`);
      } else { this.requestHashes.clear(); this.responseHashes = []; }
    }
    this.controller = new AbortController(); this.status = 'running'; this.error = null; this.startedAt = Date.now();
    this.log('Bắt đầu tải dữ liệu.');
    this.promise = (async () => {
      try {
        await this.persist();
        const reason = this.config.kind === 'browser' ? await runBrowser(this, this.manager.sessions, this.controller.signal) : await this.runApi(this.controller.signal);
        this.status = reason === 'limited' ? 'limited' : reason === 'incomplete' ? 'incomplete' : 'completed';
        if (this.status === 'completed') this.state = null;
        if (this.status === 'incomplete') this.error = this.incompleteMessage();
        this.progress.stage = reason === 'limited' ? 'Đã đạt giới hạn mỗi lượt; có thể chạy tiếp' : reason === 'incomplete' ? 'Chưa tải đủ dữ liệu; có thể chạy tiếp' : reason === 'idle' ? 'Không thấy dữ liệu hoặc nội dung thay đổi sau 3 lần kiểm tra' : 'Đã tải đủ tổng khai báo hoặc nguồn báo hết dữ liệu';
        this.log(this.progress.stage);
      } catch (error) {
        if (this.controller.signal.aborted) { this.status = 'paused'; this.progress.stage = 'Đã tạm dừng và lưu vị trí'; this.log(this.progress.stage); }
        else { this.status = 'failed'; this.error = error.message; this.progress.stage = 'Đã dừng vì lỗi'; this.log(error.message); }
      } finally {
        this.progress.elapsedMs += Date.now() - this.startedAt; this.startedAt = null;
        try { await this.persist(); }
        catch (error) { this.status = 'failed'; this.error = `Không lưu được checkpoint: ${error.message}`; }
        finally { this.promise = null; }
      }
    })();
    return this.summary();
  }
  async pause() { if (this.promise) { this.controller.abort(); await this.promise; } return this.summary(); }
  async *records(files) {
    for (const file of files) { const page = JSON.parse(await readFile(join(this.directory, 'pages', file), 'utf8')); yield* page.items; }
  }
  async export(format) {
    if (!['json', 'jsonl', 'csv'].includes(format)) throw new Error('Định dạng tải về không hợp lệ.');
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
  constructor(directory, sessions) { this.directory = directory; this.sessions = sessions; this.jobs = new Map(); }
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
  async create(input) {
    const normalized = normalizeConfig(input);
    const config = { ...normalized, kind: input.kind === 'browser' ? 'browser' : 'api', ...(input.kind === 'browser' ? { source: input.source || null } : {}) };
    if (config.kind === 'browser' && config.source) { httpUrl(config.source.origin); if (!config.source.pathname?.startsWith('/') || !['GET', 'POST'].includes(config.source.method)) throw new Error('Nguồn dữ liệu trình duyệt không hợp lệ.'); getAt({}, config.source.itemsPath); }
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const job = new Job(this, config, id);
    for (const folder of ['pages', 'files', 'exports']) await mkdir(join(job.directory, folder), { recursive: true });
    await atomicJson(join(job.directory, 'config.json'), config); await job.persist(); this.jobs.set(id, job);
    return job;
  }
  get(id) { const job = this.jobs.get(id); if (!job) throw new Error('Không tìm thấy tác vụ.'); return job; }
  list() { return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => job.summary()); }
  async close() { await Promise.allSettled([...this.jobs.values()].map(job => job.pause())); await this.sessions.closeAll(); }
}
