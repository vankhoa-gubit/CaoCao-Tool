import { msg, MessageError, errorMessage, decodeLegacy } from './messages.js';

const $ = id => document.getElementById(id);
const paths = value => [...new Set(value.split(/[\r\n,]+/).map(path => path.trim()).filter(Boolean))];
const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const option = (value, text) => { const node = element('option', text); node.value = value; return node; };
const button = (text, fn, className = 'text-button') => { const node = element('button', text, className); node.type = 'button'; node.addEventListener('click', fn); return node; };
function table(target, headers, rows) {
  target.replaceChildren();
  const head = element('thead'), tr = element('tr');
  for (const text of headers) { const th = element('th', text); th.scope = 'col'; tr.append(th); } head.append(tr);
  const body = element('tbody');
  for (const cells of rows) { const row = element('tr'); for (const value of cells) { const td = element('td'); value instanceof Node ? td.append(value) : td.textContent = value == null ? '—' : String(value); row.append(td); } body.append(row); }
  target.append(head, body);
}

export class WorkspaceUI {
  constructor({ t, message, api, notice, getLanguage }) {
    Object.assign(this, { t, message, api, notice, getLanguage });
    this.panel = 'quick'; this.tab = 'records'; this.sources = []; this.queuePage = 1; this.runPage = 1; this.pickerPage = 1; this.dataPage = 1; this.comparePage = 1; this.columns = null;
    this.versions = { workspace: 0, source: 0, runs: 0, records: 0, picker: 0, compare: 0, quality: 0, open: 0 };
    for (const node of document.querySelectorAll('[data-panel]')) node.addEventListener('click', () => this.showPanel(node.dataset.panel));
    for (const node of document.querySelectorAll('[data-data-tab]')) node.addEventListener('click', () => this.showTab(node.dataset.dataTab));
    $('new-source').addEventListener('click', () => { this.versions.source++; this.setSource(null); });
    $('profile-mode').addEventListener('change', () => this.formVisibility());
    $('profile-pagination').addEventListener('change', () => this.formVisibility());
    $('source-form').addEventListener('submit', event => { event.preventDefault(); this.guard(() => this.saveProfile(), $('save-source')); });
    $('run-source').addEventListener('click', () => this.guard(async () => { const source = await this.saveProfile(); await this.api(`/api/sources/${source.id}/run`, {}); await this.refresh(); }, $('run-source')));
    $('delete-source').addEventListener('click', () => this.guard(async () => {
      if (!this.sourceId || !confirm(this.t('sources.confirmDelete'))) return;
      const response = await fetch('/api/sources/' + this.sourceId, { method: 'DELETE' }), result = await response.json();
      if (!response.ok) throw new MessageError(result.errorMessage || decodeLegacy(result.error));
      this.setSource(null); await this.refresh();
    }, $('delete-source')));
    $('queue-form').addEventListener('submit', event => { event.preventDefault(); this.guard(async () => { const result = await this.api('/api/queue', { urls: $('queue-urls').value, sourceId: $('queue-profile').value || undefined }); $('queue-urls').value = ''; this.notice(msg('queue.added', { count: result.queue.length }), true); this.queuePage = 1; await this.refresh(); }, $('queue-add')); });
    $('refresh-workspace').addEventListener('click', () => this.guard(() => this.refresh(), $('refresh-workspace')));
    $('queue-status').addEventListener('change', () => { this.queuePage = 1; this.guard(() => this.refresh()); });
    for (const [id, field, fn, step] of [['queue-prev', 'queuePage', 'refresh', -1], ['queue-next', 'queuePage', 'refresh', 1], ['source-runs-prev', 'runPage', 'loadRuns', -1], ['source-runs-next', 'runPage', 'loadRuns', 1], ['data-run-prev', 'pickerPage', 'loadPicker', -1], ['data-run-next', 'pickerPage', 'loadPicker', 1], ['data-prev', 'dataPage', 'loadRecords', -1], ['data-next', 'dataPage', 'loadRecords', 1], ['compare-prev', 'comparePage', 'loadCompare', -1], ['compare-next', 'comparePage', 'loadCompare', 1]]) $(id).addEventListener('click', () => { this[field] = Math.max(1, this[field] + step); this.guard(() => this[fn]()); });
    $('data-source').addEventListener('change', () => { this.pickerPage = 1; this.guard(() => this.loadPicker()); });
    $('data-picker').addEventListener('submit', event => { event.preventDefault(); if ($('data-run').value) this.guard(() => this.openJob($('data-run').value)); });
    $('refresh-data').addEventListener('click', () => this.guard(async () => { await this.loadPicker(); if (this.jobId) await this.loadTab(); }, $('refresh-data')));
    $('data-search').addEventListener('input', () => { this.versions.records++; this.dataPage = 1; clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => this.guard(() => this.loadRecords()), 250); });
    $('data-limit').addEventListener('change', () => { this.dataPage = 1; this.guard(() => this.loadRecords()); });
    $('apply-columns').addEventListener('click', () => { this.columns = [...$('data-columns').querySelectorAll('input:checked')].map(input => input.value); this.dataPage = 1; this.guard(() => this.loadRecords()); });
    $('data-add-column').addEventListener('click', () => {
      const value = $('data-field-path').value.trim(); if (!value || value.length > 200) return;
      if (!this.columnOptions.includes(value)) { this.columnOptions.push(value); this.addColumn(value, true); }
      else [...$('data-columns').querySelectorAll('input')].find(input => input.value === value).checked = true;
      $('data-field-path').value = '';
    });
    $('compare-show').addEventListener('click', () => { this.comparePage = 1; this.guard(() => this.loadCompare(), $('compare-show')); });
    $('compare-base').addEventListener('change', () => { this.versions.compare++; this.comparison = null; this.renderCompare(); });
    $('compare-type').addEventListener('change', () => { this.comparePage = 1; this.guard(() => this.loadCompare()); });
    $('close-record').addEventListener('click', () => $('record-dialog').close());
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.panel === 'sources') this.guard(() => this.refresh()); else if (document.hidden) clearTimeout(this.timer); });
    window.addEventListener('pagehide', () => clearTimeout(this.timer));
    this.setSource(null);
  }
  async guard(fn, control) {
    if (control?.disabled) return;
    if (control) control.disabled = true;
    try { return await fn(); } catch (error) { this.notice(errorMessage(error)); } finally { if (control) control.disabled = false; }
  }
  time(value) { return value ? new Date(value).toLocaleString(this.getLanguage() === 'en' ? 'en-US' : 'vi-VN') : '—'; }
  status(value) { return this.t((['queued', 'scanning', 'starting', 'cancelled'].includes(value) ? 'queue.' : 'status.') + value); }
  async showPanel(panel) {
    this.panel = panel;
    for (const name of ['quick', 'sources', 'data']) $(name + '-panel').hidden = panel !== name;
    for (const node of document.querySelectorAll('[data-panel]')) node.setAttribute('aria-pressed', String(node.dataset.panel === panel));
    clearTimeout(this.timer);
    if (panel === 'sources') await this.guard(() => this.refresh());
    if (panel === 'data') await this.guard(async () => { await this.loadSources(); await this.loadPicker(); });
  }
  async loadSources() {
    const result = await this.api('/api/sources'); this.sources = result.sources; this.renderSources();
  }
  async refresh() {
    const version = ++this.versions.workspace, query = new URLSearchParams({ page: this.queuePage, status: $('queue-status').value });
    const result = await this.api('/api/workspace?' + query); if (version !== this.versions.workspace) return;
    this.snapshot = result; this.sources = result.sources; this.queuePage = result.pagination.page; this.renderSources(); this.renderQueue();
    if (result.errorMessage) this.notice(result.errorMessage);
    if (this.sourceId) {
      const source = this.sources.find(source => source.id === this.sourceId);
      $('profile-next-run').textContent = source?.schedule.enabled ? this.t('schedule.next', { time: this.time(source.schedule.nextRunAt) }) : this.t('schedule.off');
      const stamp = JSON.stringify([this.sourceId, source?.runs, source?.latest?.updatedAt, source?.latest?.status]);
      if (stamp !== this.runsStamp) { this.runsStamp = stamp; await this.loadRuns(); }
    }
    clearTimeout(this.timer);
    if (this.panel === 'sources' && !document.hidden) this.timer = setTimeout(() => this.guard(() => this.refresh()), result.active || result.queued ? 1200 : 15000);
  }
  renderSources() {
    const signature = JSON.stringify([this.getLanguage(), this.sourceId, this.sources]);
    if ($('source-list').dataset.signature !== signature) {
      const focused = document.activeElement?.dataset.sourceId;
      $('source-list').replaceChildren(); $('source-list').dataset.signature = signature;
      for (const source of this.sources) {
        const node = button('', () => this.guard(() => this.editSource(source.id)), `source-select${source.id === this.sourceId ? ' selected' : ''}`);
        node.dataset.sourceId = source.id; node.setAttribute('aria-pressed', String(source.id === this.sourceId));
        node.append(element('strong', source.name), element('span', source.url, 'hint'), element('span', this.t('sources.runs', { count: source.runs }) + ' · ' + (source.schedule.enabled ? this.t('schedule.next', { time: this.time(source.schedule.nextRunAt) }) : this.t('schedule.off')), 'hint'));
        $('source-list').append(node);
      }
      if (focused) [...$('source-list').children].find(node => node.dataset.sourceId === focused)?.focus({ preventScroll: true });
    }
    $('sources-empty').hidden = this.sources.length > 0;
    for (const [id, label] of [['queue-profile', 'queue.auto'], ['data-source', 'data.allSources']]) {
      const select = $(id), value = select.value, signature = JSON.stringify([this.getLanguage(), this.sources.map(source => [source.id, source.name])]);
      if (select.dataset.signature === signature) continue;
      select.replaceChildren(option('', this.t(label)), ...this.sources.map(source => option(source.id, source.name))); select.value = value; select.dataset.signature = signature;
    }
  }
  async editSource(id) {
    const version = ++this.versions.source, source = await this.api('/api/sources/' + id); if (version !== this.versions.source) return;
    this.setSource(source); await this.loadRuns();
  }
  setSource(source) {
    this.sourceId = source?.id || null; this.rawConfig = structuredClone(source?.config || { request: {}, extract: {}, pagination: {}, limits: {}, download: {} }); this.runPage = 1; this.runs = null; this.runsStamp = null;
    const c = this.rawConfig, p = c.pagination || {}, batch = p.batch || {};
    const values = { 'profile-name': source?.name || '', 'profile-url': source?.url || '', 'profile-mode': source?.mode || 'auto', 'profile-api-url': c.request?.url || source?.url || '', 'profile-method': c.request?.method || 'GET', 'profile-items': c.extract?.itemsPath || 'items', 'profile-key': c.extract?.uniqueKey || '', 'profile-pagination': p.mode || 'none', 'profile-location': p.location || 'query', 'profile-param': p.param || 'page', 'profile-start': p.start ?? '', 'profile-step': p.step ?? 1, 'profile-size': p.pageSize ?? 0, 'profile-size-param': p.sizeParam || '', 'profile-next': p.nextPath || '', 'profile-more': p.hasMorePath || '', 'profile-total': p.totalPath || '', 'profile-batch-param': batch.param || 'batch', 'profile-batch-start': batch.start ?? '', 'profile-batch-step': batch.step ?? 1, 'profile-batch-next': batch.nextPath || '', 'profile-batch-more': batch.hasMorePath || '', 'profile-fields': source?.fields?.join('\n') || '', 'profile-required': source?.requiredFields?.join('\n') || '', 'profile-headers': Object.entries(c.request?.headers || {}).map(([key, value]) => `${key}: ${value}`).join('\n'), 'profile-body-type': c.request?.bodyType || 'json', 'profile-body': c.request?.body == null ? '' : typeof c.request.body === 'object' ? c.request.bodyType === 'form' ? new URLSearchParams(c.request.body).toString() : JSON.stringify(c.request.body, null, 2) : c.request.body, 'profile-limit': c.limits?.maxRequests ?? 200, 'profile-delay': c.limits?.delayMs ?? 300, 'profile-file-paths': c.download?.paths?.join('\n') || '', 'profile-interval': source?.schedule?.intervalMinutes || 60 };
    if (!source) values['profile-start'] = '1';
    for (const [id, value] of Object.entries(values)) $(id).value = value;
    $('profile-short').checked = p.stopOnShortPage === true; $('profile-download').checked = c.download?.enabled === true; $('profile-schedule').checked = source?.schedule?.enabled === true;
    $('run-source').hidden = $('delete-source').hidden = !this.sourceId;
    $('profile-next-run').textContent = source?.schedule?.enabled ? this.t('schedule.next', { time: this.time(source.schedule.nextRunAt) }) : this.t('schedule.off');
    this.formVisibility(); this.renderSources(); this.renderRuns();
  }
  formVisibility() {
    const api = $('profile-mode').value === 'api', pagination = $('profile-pagination').value;
    $('profile-api-fields').hidden = !api; $('profile-request-fields').hidden = !api;
    $('profile-api-url').required = api;
    $('profile-pagination-fields').hidden = pagination === 'none'; $('profile-batch-fields').hidden = pagination !== 'batch';
    $('profile-browser-hint').hidden = $('profile-mode').value !== 'browser';
    for (const input of $('profile-api-fields').querySelectorAll('input,select')) input.disabled = !api;
  }
  readSource() {
    const value = id => $(id).value.trim(), mode = value('profile-mode'), c = structuredClone(this.rawConfig);
    let headers = c.request?.headers || {}, body = c.request?.body;
    if (mode === 'api') {
      headers = {};
      for (const line of $('profile-headers').value.split(/\r?\n/).filter(line => line.trim())) { const colon = line.indexOf(':'); if (colon < 1) throw new MessageError('headers.invalid'); headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim(); }
      const raw = $('profile-body').value, type = value('profile-body-type'); body = raw || null;
      if (type === 'json' && raw) { try { body = JSON.parse(raw); } catch { throw new MessageError('source.formJson'); } }
      if (type === 'form' && raw) body = Object.fromEntries(new URLSearchParams(raw));
      c.request = { ...c.request, url: value('profile-api-url'), method: value('profile-method'), headers, body, bodyType: type };
      const p = c.pagination || {}, numericOrText = text => text === '' ? null : /^\d+$/.test(text) ? Number(text) : text;
      c.pagination = { ...p, mode: value('profile-pagination'), location: value('profile-location'), param: value('profile-param'), start: value('profile-pagination') === 'cursor' ? numericOrText(value('profile-start')) : Number(value('profile-start') || (value('profile-pagination') === 'offset' ? 0 : 1)), step: Number(value('profile-step')), pageSize: Number(value('profile-size')), sizeParam: value('profile-size-param'), nextPath: value('profile-next'), hasMorePath: value('profile-more'), totalPath: value('profile-total'), stopOnShortPage: $('profile-short').checked, batch: { ...p.batch, location: p.batch?.location || value('profile-location'), param: value('profile-batch-param'), start: numericOrText(value('profile-batch-start')), step: Number(value('profile-batch-step')), nextPath: value('profile-batch-next'), hasMorePath: value('profile-batch-more') } };
    } else c.request = { ...c.request, url: value('profile-url') };
    c.extract = { ...c.extract, itemsPath: mode === 'api' ? value('profile-items') : c.extract?.itemsPath || '$', uniqueKey: value('profile-key') || (mode === 'browser' ? '_key' : '') };
    c.limits = { ...c.limits, maxRequests: Number(value('profile-limit')), delayMs: Number(value('profile-delay')) };
    c.download = { ...c.download, enabled: $('profile-download').checked, paths: paths($('profile-file-paths').value) };
    return { name: value('profile-name'), url: value('profile-url'), mode, config: c, fields: paths($('profile-fields').value), requiredFields: paths($('profile-required').value), schedule: { enabled: $('profile-schedule').checked, intervalMinutes: Number(value('profile-interval')) } };
  }
  async saveProfile() {
    const source = await this.api('/api/sources' + (this.sourceId ? '/' + this.sourceId : ''), this.readSource());
    this.sourceId = source.id; this.rawConfig = source.config; this.runsStamp = null;
    $('run-source').hidden = $('delete-source').hidden = false;
    this.notice(msg('source.saved'), true); await this.refresh(); return source;
  }
  async prefill(config, url, mode) {
    this.versions.source++;
    this.setSource({ name: config.name || this.t('source.defaultName'), url: url || config.request.url, mode: mode || config.kind || 'api', config, fields: config.exportFields || [], requiredFields: config.requiredFields || [], schedule: { enabled: false, intervalMinutes: 60 } });
    await this.showPanel('sources'); $('profile-name').focus({ preventScroll: true });
  }
  async loadRuns() {
    const version = ++this.versions.runs, id = this.sourceId; if (!id) { this.runs = null; this.renderRuns(); return; }
    const result = await this.api(`/api/sources/${id}/runs?page=${this.runPage}&limit=10`); if (id !== this.sourceId || version !== this.versions.runs) return;
    this.runs = result; this.runPage = result.pagination.page; this.renderRuns();
  }
  renderRuns() {
    $('source-runs').replaceChildren();
    for (const job of this.runs?.jobs || []) {
      const row = element('div', null, 'run-row');
      row.append(element('span', `${this.time(job.createdAt)} · ${this.status(job.status)} · ${job.progress.items}`), button(this.t('workspace.data'), () => this.guard(() => this.openJob(job.id)))); $('source-runs').append(row);
    }
    if (!this.runs?.jobs.length) $('source-runs').append(element('p', this.t('sources.noRuns'), 'hint'));
    this.pagination('source-runs', this.runs?.pagination, 'history.page');
  }
  renderQueue() {
    if (!this.snapshot) return;
    const result = this.snapshot; $('queue-counts').textContent = this.t('queue.counts', result);
    const signature = JSON.stringify([this.getLanguage(), result.queue]);
    if ($('queue-list').dataset.signature !== signature) {
      const focused = document.activeElement?.dataset.queueAction;
      $('queue-list').replaceChildren(); $('queue-list').dataset.signature = signature;
      for (const item of result.queue) {
        const row = element('article', null, 'queue-row'), info = element('div');
        info.append(element('strong', item.name), element('p', item.url, 'hint'), element('p', this.t('queue.attempts', { count: item.attempts }) + (item.progress ? ` · ${item.progress.items}` : ''), 'hint'));
        if (item.errorMessage) info.append(element('p', this.message(item.errorMessage), 'queue-error'));
        const controls = element('div', null, 'inline-actions'); controls.append(element('span', this.status(item.status), `badge ${item.status}`));
        for (const action of ['retry', 'cancel']) {
          const allowed = action === 'retry' ? ['failed', 'limited', 'incomplete', 'paused', 'cancelled'] : ['queued', 'scanning', 'starting', 'running']; if (!allowed.includes(item.status)) continue;
          const control = button(this.t('queue.' + action), () => this.guard(async () => { await this.api(`/api/queue/${item.id}/${action}`, {}); await this.refresh(); }, control)); control.dataset.queueAction = `${item.id}/${action}`; controls.append(control);
        }
        if (item.jobId) controls.append(button(this.t('workspace.data'), () => this.guard(() => this.openJob(item.jobId))));
        row.append(info, controls); $('queue-list').append(row);
      }
      if (!result.queue.length) $('queue-list').append(element('p', this.t('queue.empty'), 'hint'));
      if (focused) [...$('queue-list').querySelectorAll('[data-queue-action]')].find(node => node.dataset.queueAction === focused)?.focus({ preventScroll: true });
    }
    this.pagination('queue', result.pagination, 'queue.page');
  }
  pagination(prefix, p, label) {
    $(prefix + '-page').textContent = p ? this.t(label, p) : '';
    $(prefix + '-prev').disabled = !p || p.page <= 1; $(prefix + '-next').disabled = !p || p.page >= p.pages;
  }
  async loadPicker() {
    const version = ++this.versions.picker, sourceId = $('data-source').value;
    const result = await this.api(sourceId ? `/api/sources/${sourceId}/runs?page=${this.pickerPage}&limit=20` : `/api/jobs?page=${this.pickerPage}&limit=20`);
    if (version !== this.versions.picker) return;
    this.picker = result; this.pickerPage = result.pagination.page; this.renderPicker();
  }
  renderPicker() {
    if (!this.picker) return;
    const previous = $('data-run').value;
    $('data-run').replaceChildren(...this.picker.jobs.map(job => option(job.id, `${job.name} · ${this.time(job.createdAt)} · ${this.status(job.status)} · ${job.progress.items}`)));
    if (this.picker.jobs.some(job => job.id === previous)) $('data-run').value = previous;
    else if (this.picker.jobs.some(job => job.id === this.jobId)) $('data-run').value = this.jobId;
    $('data-run-page').textContent = this.t('history.page', this.picker.pagination);
    $('data-run-prev').disabled = this.picker.pagination.page <= 1; $('data-run-next').disabled = this.picker.pagination.page >= this.picker.pagination.pages;
    const base = $('compare-base').value;
    const jobs = this.picker.jobs.filter(job => job.id !== this.jobId && job.sourceId && job.sourceId === this.job?.sourceId);
    $('compare-base').replaceChildren(...jobs.map(job => option(job.id, `${this.time(job.createdAt)} · ${this.status(job.status)} · ${job.progress.items}`)));
    if (jobs.some(job => job.id === base)) $('compare-base').value = base;
    $('compare-empty').hidden = jobs.length > 0; $('compare-show').disabled = !jobs.length;
  }
  async openJob(id) {
    const version = ++this.versions.open; this.versions.records++; this.versions.quality++; this.versions.compare++;
    const job = await this.api('/api/jobs/' + id); if (version !== this.versions.open) return;
    this.job = job; this.jobId = id; this.records = null; this.quality = null; this.comparison = null; this.columns = null; this.dataPage = this.comparePage = 1;
    $('data-search').value = ''; this.tab = 'records';
    await this.showPanel('data'); if (version !== this.versions.open) return;
    $('data-source').value = job.sourceId && this.sources.some(source => source.id === job.sourceId) ? job.sourceId : ''; this.pickerPage = 1; await this.loadPicker(); if (version !== this.versions.open) return;
    $('data-empty').hidden = true; $('data-content').hidden = false;
    this.renderJob(); await this.showTab('records');
  }
  renderJob() { $('dataset-name').textContent = this.job ? `${this.job.name} · ${this.time(this.job.createdAt)} · ${this.status(this.job.status)}` : ''; }
  async showTab(tab) {
    this.tab = tab;
    for (const name of ['records', 'compare', 'quality']) $(name + '-tab').hidden = name !== tab;
    for (const node of document.querySelectorAll('[data-data-tab]')) node.setAttribute('aria-pressed', String(node.dataset.dataTab === tab));
    if (this.jobId) await this.guard(() => this.loadTab());
  }
  async loadTab() {
    if (this.tab === 'records') await this.loadRecords();
    if (this.tab === 'quality') await this.loadQuality();
    if (this.tab === 'compare') { this.renderPicker(); this.renderCompare(); }
  }
  async loadRecords() {
    if (!this.jobId) return;
    const version = ++this.versions.records, id = this.jobId;
    $('data-loading').hidden = false;
    const query = new URLSearchParams({ page: this.dataPage, limit: $('data-limit').value, search: $('data-search').value });
    if (this.columns !== null) query.set('columns', JSON.stringify(this.columns));
    try {
      const result = await this.api(`/api/jobs/${id}/records?${query}`); if (version !== this.versions.records || id !== this.jobId) return;
      this.records = result; this.dataPage = result.pagination.page; this.job = result.job; this.columns = result.columns;
      this.columnOptions = [...new Set([...result.availableColumns, ...result.columns])]; this.renderColumns(); this.renderRecords(); this.renderJob();
    } finally { if (version === this.versions.records) $('data-loading').hidden = true; }
  }
  addColumn(column, checked) { const label = element('label', null, 'check-label'); const input = element('input'); input.type = 'checkbox'; input.value = column; input.checked = checked; label.append(input, element('span', column)); $('data-columns').append(label); }
  renderColumns() { $('data-columns').replaceChildren(); for (const column of this.columnOptions || []) this.addColumn(column, this.columns?.includes(column)); }
  renderRecords() {
    if (!this.records) return;
    const r = this.records;
    table($('data-table'), ['#', ...r.columns, this.t('data.actions')], r.rows.map(row => [row.index + 1, ...row.values, button(this.t('data.full'), () => this.guard(() => this.showRecord(this.jobId, row.index)))]));
    $('data-no-rows').hidden = r.rows.length > 0; this.pagination('data', r.pagination, 'data.page');
    const query = new URLSearchParams({ search: $('data-search').value, columns: JSON.stringify(r.columns) });
    for (const format of ['json', 'jsonl', 'csv']) $('filtered-' + format).href = `/api/jobs/${this.jobId}/records/export/${format}?${query}`;
  }
  async showRecord(id, index) { const result = await this.api(`/api/jobs/${id}/records/${index}`); $('record-json').textContent = JSON.stringify(result.record, null, 2); if (!$('record-dialog').open) $('record-dialog').showModal(); }
  async loadCompare() {
    if (!this.jobId || !$('compare-base').value) return;
    const version = ++this.versions.compare, id = this.jobId, base = $('compare-base').value;
    const result = await this.api(`/api/jobs/${id}/compare?` + new URLSearchParams({ base, type: $('compare-type').value, page: this.comparePage }));
    if (version !== this.versions.compare || id !== this.jobId) return;
    this.comparison = result; this.comparePage = result.pagination.page; this.renderCompare();
  }
  renderCompare() {
    const r = this.comparison; $('compare-summary').textContent = r ? this.t('compare.summary', r.counts) : '';
    $('compare-warning').hidden = !r || r.missingConfirmed; $('compare-identity').hidden = !r || r.stableIdentity;
    table($('compare-table'), [this.t('compare.type'), this.t('compare.key'), this.t('data.actions')], (r?.rows || []).map(row => {
      const controls = element('div', null, 'inline-actions');
      if (row.baseIndex !== null) controls.append(button(this.t('data.before'), () => this.guard(() => this.showRecord(r.baseId, row.baseIndex))));
      if (row.currentIndex !== null) controls.append(button(this.t('data.after'), () => this.guard(() => this.showRecord(r.jobId, row.currentIndex))));
      return [this.t('compare.' + row.type), row.key, controls];
    })); this.pagination('compare', r?.pagination, 'compare.page');
  }
  async loadQuality() {
    const version = ++this.versions.quality, id = this.jobId; if (!id) return;
    const result = await this.api(`/api/jobs/${id}/quality`); if (version !== this.versions.quality || id !== this.jobId) return;
    this.quality = result; this.renderQuality();
  }
  renderQuality() {
    const r = this.quality; if (!r) return;
    $('quality-confidence').textContent = this.t('quality.' + r.completeness.level); $('quality-confidence').className = r.completeness.confirmed ? 'report-success' : 'report-warning';
    $('quality-summary').textContent = this.t('quality.summary', { records: r.recordCount, fileErrors: r.fileErrorCount, requiredErrors: r.requiredRecordErrors });
    $('quality-truncated').hidden = !r.fieldsTruncated && r.fileErrorCount <= 100;
    table($('quality-table'), [this.t('quality.field'), this.t('quality.present'), this.t('quality.missing'), this.t('quality.emptyValue'), this.t('quality.types'), this.t('quality.required')], r.fields.map(field => [field.path, field.present, field.missing, field.empty, Object.entries(field.types).map(([key, count]) => `${key}: ${count}`).join(', '), field.required ? '✓' : '—']));
    $('quality-schema').replaceChildren(); $('quality-schema-warning').hidden = !r.schema || r.schema.confirmed;
    if (!r.schema) $('quality-schema').append(element('p', this.t('quality.noBaseline'), 'hint'));
    else {
      const list = element('ul');
      for (const [type, names] of [['added', r.schema.added], ['missing', r.schema.missing]]) for (const name of names) list.append(element('li', this.t('compare.' + type) + ': ' + name));
      for (const change of r.schema.changedTypes) list.append(element('li', `${change.path}: ${change.before} → ${change.after}`));
      $('quality-schema').append(list.childElementCount ? list : element('p', this.t('quality.schemaNone'), 'hint'));
    }
    $('quality-files').replaceChildren();
    for (const error of r.fileErrors) { const row = element('div', null, 'file-error-row'); row.append(element('code', error.url), element('p', this.message(error.errorMessage), 'hint')); $('quality-files').append(row); }
    if (!r.fileErrors.length) $('quality-files').append(element('p', this.t('quality.noFileErrors'), 'hint'));
  }
  renderLanguage() {
    this.renderSources(); this.renderQueue(); this.renderRuns(); this.renderPicker(); this.renderJob(); this.renderRecords(); this.renderCompare(); this.renderQuality();
    const source = this.sources.find(source => source.id === this.sourceId);
    $('profile-next-run').textContent = source?.schedule.enabled ? this.t('schedule.next', { time: this.time(source.schedule.nextRunAt) }) : this.t('schedule.off');
  }
}
