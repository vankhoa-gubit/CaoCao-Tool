import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson } from './jobs.mjs';
import { httpUrl, normalizeConfig, fieldPaths } from './config.mjs';
import { msg, MessageError, errorMessage } from './messages.mjs';

const activeStatuses = new Set(['queued', 'scanning', 'starting', 'running']);
export { fieldPaths } from './config.mjs';
export function normalizeSource(input, previous, now = Date.now()) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !['auto', 'api', 'browser'].includes(input.mode || 'auto')) throw new MessageError('source.invalid');
  const url = httpUrl(input.url).href, mode = input.mode || 'auto';
  const raw = input.config || { request: { url }, extract: { itemsPath: '$', uniqueKey: mode === 'browser' ? '_key' : '' } };
  const config = { ...normalizeConfig(raw), kind: mode === 'browser' ? 'browser' : 'api', ...(mode === 'browser' ? { source: raw.source || null } : {}) };
  const schedule = input.schedule || { enabled: false, intervalMinutes: 60 };
  const intervalMinutes = Number(schedule.intervalMinutes ?? 60);
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 525600) throw new MessageError('schedule.invalid');
  const enabled = schedule.enabled === true;
  return {
    id: previous?.id || randomUUID(), name: input.name.trim(), url, mode, config,
    fields: fieldPaths(input.fields), requiredFields: fieldPaths(input.requiredFields),
    createdAt: previous?.createdAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    schedule: { enabled, intervalMinutes, nextRunAt: enabled ? (previous?.schedule.enabled && previous.schedule.intervalMinutes === intervalMinutes ? previous.schedule.nextRunAt : new Date(now + intervalMinutes * 60000).toISOString()) : null },
  };
}

export class SourceWorkspace {
  constructor(directory, manager, analyze, { now = () => Date.now(), tickMs = 500 } = {}) {
    this.directory = directory; this.manager = manager; this.analyze = analyze; this.now = now; this.tickMs = tickMs;
    this.store = { formatVersion: 1, sources: [], queue: [] }; this.writes = Promise.resolve(); this.active = new Map(); this.closing = false;
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    try {
      const store = JSON.parse(await readFile(join(this.directory, 'workspace.json'), 'utf8'));
      if (store.formatVersion !== 1 || !Array.isArray(store.sources) || !Array.isArray(store.queue)) throw new MessageError('workspace.store');
      const ids = new Set(), validId = value => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);
      for (const source of store.sources) {
        if (!source || !validId(source.id) || ids.has(source.id) || !source.schedule || source.schedule.enabled && !Number.isFinite(Date.parse(source.schedule.nextRunAt))) throw new MessageError('workspace.store');
        normalizeSource(source, source, this.now()); ids.add(source.id);
      }
      ids.clear();
      for (const item of store.queue) {
        if (!item || !validId(item.id) || ids.has(item.id) || !['queued', 'scanning', 'starting', 'running', 'completed', 'failed', 'limited', 'incomplete', 'paused', 'cancelled'].includes(item.status) || !Number.isSafeInteger(item.attempts) || item.attempts < 0 || item.sourceId != null && !validId(item.sourceId) || item.jobId != null && !validId(item.jobId)) throw new MessageError('workspace.store');
        httpUrl(item.url); ids.add(item.id);
      }
      this.store = store;
    } catch (error) { if (error.code !== 'ENOENT') throw new MessageError('workspace.store'); }
    if (this.store.queue.some(item => ['running', 'starting', 'scanning'].includes(item.status))) await this.mutate(store => {
      for (const item of store.queue) if (['running', 'starting', 'scanning'].includes(item.status)) {
        item.status = item.jobId && this.manager.jobs.has(item.jobId) ? this.manager.get(item.jobId).status : 'queued';
        item.updatedAt = this.time();
      }
    });
    return this;
  }
  time() { return new Date(this.now()).toISOString(); }
  mutate(fn) {
    const task = this.writes.then(async () => {
      const draft = structuredClone(this.store), result = fn(draft);
      await atomicJson(join(this.directory, 'workspace.json'), draft); this.store = draft; return result;
    });
    this.writes = task.catch(() => {}); return task;
  }
  source(id) {
    const source = this.store.sources.find(source => source.id === id);
    if (!source) throw new MessageError('source.notFound'); return structuredClone(source);
  }
  sourceSummary(source) {
    const jobs = [...this.manager.jobs.values()].filter(job => job.config.sourceId === source.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { id: source.id, name: source.name, url: source.url, mode: source.mode, fields: source.fields, schedule: source.schedule, runs: jobs.length, latest: jobs[0]?.summary({ detail: false }) || null };
  }
  async saveSource(input, id) {
    if (this.closing) throw new MessageError('manager.closed');
    return this.mutate(store => {
      const previous = id ? store.sources.find(source => source.id === id) : null;
      if (id && !previous) throw new MessageError('source.notFound');
      const source = normalizeSource(input, previous, this.now());
      if (previous) store.sources[store.sources.indexOf(previous)] = source; else store.sources.push(source);
      return source;
    });
  }
  async deleteSource(id) {
    this.source(id);
    return this.mutate(store => {
      if (store.queue.some(item => item.sourceId === id && activeStatuses.has(item.status)) || [...this.manager.jobs.values()].some(job => job.config.sourceId === id && job.promise)) throw new MessageError('source.inUse');
      store.sources = store.sources.filter(source => source.id !== id); return { deleted: true };
    });
  }
  configFor(source, url) {
    const config = structuredClone(source.config);
    if (url !== source.url) {
      if (httpUrl(url).origin !== httpUrl(config.request.url).origin) throw new MessageError('source.crossOrigin');
      config.request.url = url;
      if (config.kind === 'browser') { config.source = null; config.extract = { itemsPath: '$', uniqueKey: '_key' }; }
    }
    return { ...config, name: source.name, sourceId: source.id, exportFields: source.fields, requiredFields: source.requiredFields };
  }
  async enqueue({ urls, sourceId, trigger = 'manual' }) {
    if (this.closing) throw new MessageError('manager.closed');
    const source = sourceId ? this.source(sourceId) : null;
    const input = urls === undefined && source ? [source.url] : typeof urls === 'string' ? urls.split(/\r?\n/).map(url => url.trim()).filter(Boolean) : urls;
    if (!Array.isArray(input) || !input.length || input.length > 100 || input.some(url => typeof url !== 'string')) throw new MessageError('queue.invalid');
    const normalized = [...new Set(input.map(url => httpUrl(url).href))];
    if (source?.mode !== 'auto' && source) for (const url of normalized) this.configFor(source, url);
    const items = await this.mutate(store => {
      const items = normalized.map(url => ({ id: randomUUID(), sourceId: source?.id || null, name: source?.name || url, url, trigger: trigger === 'schedule' ? 'schedule' : 'manual', status: 'queued', jobId: null, attempts: 0, errorMessage: null, createdAt: this.time(), updatedAt: this.time() }));
      store.queue.push(...items); return items;
    });
    this.kick(); return items;
  }
  item(id) {
    const item = this.store.queue.find(item => item.id === id);
    if (!item) throw new MessageError('queue.notFound'); return item;
  }
  queueSummary(item) {
    const job = item.jobId ? this.manager.jobs.get(item.jobId) : null;
    const status = job && (!['queued', 'scanning', 'starting', 'cancelled'].includes(item.status) || job.promise || job.status === 'completed') ? job.status : item.status;
    return { ...item, status, progress: job?.summary({ detail: false }).progress || null, errorMessage: job?.errorMessage || (status === 'failed' ? item.errorMessage : null) };
  }
  snapshot({ page = 1, status = '' } = {}) {
    page = Number(page);
    if (!Number.isSafeInteger(page) || page < 1 || status && !['queued', 'scanning', 'starting', 'running', 'completed', 'failed', 'limited', 'incomplete', 'paused', 'cancelled'].includes(status)) throw new MessageError('history.query');
    const items = [...this.store.queue].reverse().map(item => this.queueSummary(item)).filter(item => !status || item.status === status);
    const pages = Math.max(1, Math.ceil(items.length / 20)); page = Math.min(page, pages);
    return { sources: this.store.sources.map(source => this.sourceSummary(source)), queue: items.slice((page - 1) * 20, page * 20), pagination: { page, pages, total: items.length, limit: 20 }, active: this.active.size, queued: this.store.queue.filter(item => item.status === 'queued').length, errorMessage: this.lastError || null };
  }
  async retry(id) {
    if (this.closing) throw new MessageError('manager.closed');
    if (this.active.has(id)) throw new MessageError('queue.retry');
    return this.mutate(store => {
      const item = store.queue.find(item => item.id === id);
      if (!item) throw new MessageError('queue.notFound');
      const job = this.manager.jobs.get(item.jobId);
      if (job?.promise || job?.status === 'completed') throw new MessageError('queue.retry');
      if (!['failed', 'limited', 'incomplete', 'paused', 'cancelled'].includes(item.status)) throw new MessageError('queue.retry');
      item.status = 'queued'; item.errorMessage = null; item.updatedAt = this.time(); return item;
    }).then(item => { this.kick(); return item; });
  }
  async cancel(id) {
    this.item(id);
    await this.mutate(store => { const item = store.queue.find(item => item.id === id), job = this.manager.jobs.get(item.jobId); if (!activeStatuses.has(item.status) && !job?.promise || job?.status === 'completed') throw new MessageError('queue.cancel'); item.status = 'cancelled'; item.updatedAt = this.time(); });
    const running = this.active.get(id); running?.controller.abort(new MessageError('queue.cancelled'));
    if (running?.job) await running.job.pause();
    else { const job = this.manager.jobs.get(this.item(id).jobId); if (job?.promise) await job.pause(); }
    if (running) await running.promise;
    return this.queueSummary(this.item(id));
  }
  start() {
    if (this.timer || this.closing) return;
    this.timer = setInterval(() => this.kick(), this.tickMs); this.timer.unref(); this.kick();
  }
  kick() { if (!this.closing) this.tick().catch(error => { this.lastError = errorMessage(error); }); }
  tick() {
    if (this.tickTask) return this.tickTask;
    this.tickTask = this.drain().finally(() => { this.tickTask = null; }); return this.tickTask;
  }
  async drain() {
    if (this.closing) return;
    const due = this.store.sources.filter(source => source.schedule.enabled && Date.parse(source.schedule.nextRunAt) <= this.now());
    if (due.length) await this.mutate(store => {
      for (const source of store.sources) if (source.schedule.enabled && Date.parse(source.schedule.nextRunAt) <= this.now()) {
        const busy = store.queue.some(item => item.sourceId === source.id && activeStatuses.has(item.status)) || [...this.manager.jobs.values()].some(job => job.config.sourceId === source.id && job.promise);
        if (!busy) store.queue.push({ id: randomUUID(), sourceId: source.id, name: source.name, url: source.url, trigger: 'schedule', status: 'queued', jobId: null, attempts: 0, errorMessage: null, createdAt: this.time(), updatedAt: this.time() });
        source.schedule.nextRunAt = new Date(this.now() + source.schedule.intervalMinutes * 60000).toISOString();
      }
    });
    while (!this.closing && this.manager.slots.size < this.manager.maxRunning) {
      const next = this.store.queue.find(item => item.status === 'queued' && !this.active.has(item.id)); if (!next) break;
      const reservation = Symbol('queued-run'); this.manager.admit(reservation);
      const controller = new AbortController(), active = { controller, job: null, reservation };
      this.active.set(next.id, active);
      active.promise = this.execute(next.id, active).finally(() => { this.manager.release(reservation); this.active.delete(next.id); this.kick(); });
      // execute handles operation errors; store failures remain visible through lastError.
      active.promise.catch(error => { this.lastError = errorMessage(error); });
      await this.writes;
    }
  }
  async execute(id, active) {
    const signal = active.controller.signal;
    try {
      await this.mutate(store => { const item = store.queue.find(item => item.id === id); if (item.status === 'cancelled') throw new MessageError('queue.cancelled'); item.status = 'starting'; item.attempts++; item.errorMessage = null; item.updatedAt = this.time(); });
      signal.throwIfAborted(); const item = this.item(id);
      let job = item.jobId ? this.manager.jobs.get(item.jobId) : null;
      if (!job) {
        const source = item.sourceId ? this.source(item.sourceId) : null;
        let config;
        if (source && source.mode !== 'auto') config = this.configFor(source, item.url);
        else {
          await this.mutate(store => { store.queue.find(item => item.id === id).status = 'scanning'; });
          const scanSignal = AbortSignal.any([signal, AbortSignal.timeout(90000)]);
          const report = await this.analyze(item.url, scanSignal);
          if (['blocked', 'login', 'unknown'].includes(report.capability)) throw new MessageError(report.messageData);
          if (!report.recommendation) throw new MessageError('scan.apiIncomplete');
          config = { ...report.recommendation, ...(source ? { name: source.name, limits: source.config.limits, download: { ...report.recommendation.download, ...source.config.download }, saveRaw: source.config.saveRaw, sourceId: source.id, exportFields: source.fields, requiredFields: source.requiredFields } : {}) };
        }
        signal.throwIfAborted(); job = await this.manager.create({ ...config, queueId: id }); active.job = job;
        await this.mutate(store => { store.queue.find(item => item.id === id).jobId = job.id; });
      }
      active.job = job; signal.throwIfAborted(); job.start(active.reservation);
      await this.mutate(store => { const item = store.queue.find(item => item.id === id); if (item.status !== 'cancelled') item.status = 'running'; });
      await job.promise;
      await this.mutate(store => { const item = store.queue.find(item => item.id === id); if (item.status !== 'cancelled') item.status = job.status; item.errorMessage = job.errorMessage; item.updatedAt = this.time(); });
    } catch (error) {
      await this.mutate(store => { const item = store.queue.find(item => item.id === id); if (item.status !== 'cancelled') item.status = signal.aborted ? 'paused' : 'failed'; item.errorMessage = signal.aborted ? null : errorMessage(error); item.updatedAt = this.time(); });
    }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; clearInterval(this.timer); this.timer = null;
    this.closePromise = (async () => {
      await Promise.allSettled([this.tickTask]);
      for (const active of this.active.values()) active.controller.abort();
      await Promise.allSettled([...this.active.values()].map(active => active.job?.pause()));
      await Promise.allSettled([...this.active.values()].map(active => active.promise)); await this.writes;
    })();
    return this.closePromise;
  }
}
