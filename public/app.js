import { msg, decodeLegacy, MessageError, errorMessage, fields } from './messages.js';
import { translate, translateMessage, readLanguage, saveLanguage, normalizeLanguage, localeFor, storageKey } from './i18n.js';
import { WorkspaceUI } from './workspace.js';

const $ = id => document.getElementById(id);
const state = { language: readLanguage(), scanId: null, scanProgress: null, report: null, jobs: [], selectedJob: null, detail: null, detailStamp: null, page: 1, pagination: { page: 1, pages: 1, total: 0 }, search: '', status: '', historyVersion: 0, running: 0, loginId: null, polling: false, connected: null, starting: false, notice: null, preview: null, copied: false };
const t = (key, values) => translate(state.language, key, values);
const message = value => translateMessage(value, state.language);
const number = value => new Intl.NumberFormat(localeFor(state.language)).format(value || 0);
const baseConfig = { name: t('source.defaultName'), request: { url: '', method: 'GET', headers: {}, body: null, bodyType: 'json' }, extract: { itemsPath: 'data.items', uniqueKey: '' }, pagination: { mode: 'page', location: 'query', param: 'page', start: 1, step: 1, hasMorePath: '' }, limits: { maxRequests: 200, delayMs: 300, timeoutMs: 30000, retries: 3 }, download: { enabled: false, paths: [] }, saveRaw: true };
$('config-editor').value = JSON.stringify(baseConfig, null, 2);

function setLanguage(language, persist = true) {
  state.language = normalizeLanguage(language);
  if (persist) saveLanguage(state.language);
  document.documentElement.lang = state.language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const attribute of ['aria-label', 'placeholder']) {
    for (const element of document.querySelectorAll(`[data-i18n-${attribute}]`)) element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)));
  }
  for (const button of document.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button.dataset.language === state.language));
  renderConnection(); renderNotice(); renderScanProgress(); renderPreview();
  if (state.report) renderReport(state.report, false);
  renderJobs();
  workspace.renderLanguage();
  $('copy-path').textContent = t(state.copied ? 'downloads.copied' : 'downloads.copy');
}
function renderConnection() {
  $('connection-dot').className = state.connected === null ? 'dot' : state.connected ? 'dot connected' : 'dot offline';
  $('connection-label').textContent = t(state.connected === null ? 'connection.connecting' : state.connected ? 'connection.online' : 'connection.offline');
}
function renderNotice() {
  $('notice').textContent = message(state.notice?.message);
  $('notice').className = state.notice?.success ? 'success' : '';
  $('notice').hidden = !state.notice?.message;
}
function renderScanProgress() {
  if (!state.scanProgress) return;
  $('scan-stage').textContent = message(state.scanProgress.stageMessage || state.scanProgress.stage);
  $('scan-counts').textContent = state.scanProgress.opening ? t('scan.browser') : t('scan.counts', { requests: number(state.scanProgress.requests), records: number(state.scanProgress.records) });
}
function renderPreview() {
  if (!state.preview) return;
  const { type, result } = state.preview;
  if (type === 'archive') {
    const info = result.summary;
    $('preview-result').textContent = t('preview.archive', { count: number(info.observedRecords), total: info.total != null ? ` / ${number(info.total)}` : '', key: info.uniqueKey || t('preview.content'), offset: info.nextOffset ?? t('preview.unknown') }) + '\n\n' + sample(result.sample);
  } else $('preview-result').textContent = t('preview.paths', { paths: result.paths.map(path => `${path.path} (${number(path.count)})`).join(', ') }) + '\n\n' + result.responseText;
  $('preview-result').hidden = false;
}

async function api(url, body) {
  const response = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new MessageError(value.errorMessage || (value.error ? decodeLegacy(value.error) : msg('request.failed')));
  return value;
}
function notice(message, success = false) { state.notice = { message, success }; renderNotice(); }
function sample(value) { return JSON.stringify(value, (key, item) => key === '_key' ? undefined : typeof item === 'string' && item.length > 3000 ? `${item.slice(0, 3000)}…` : item, 2); }
function config() { try { return JSON.parse($('config-editor').value); } catch { throw new MessageError('config.invalidJson'); } }
function setBusy(scanning) { $('scan-button').disabled = scanning; $('site-url').disabled = scanning; $('demo-infinite').disabled = scanning; $('demo-pages').disabled = scanning; $('scan-progress').hidden = !scanning; }

async function scan() {
  notice(''); state.report = null; $('report').hidden = true;
  const url = $('site-url').value.trim();
  if (!url) { notice(msg('scan.urlRequired')); return; }
  try {
    setBusy(true); state.scanProgress = { ...fields(msg('scan.preparing'), 'stage'), opening: true }; renderScanProgress();
    const result = await api('/api/scans', { url }); state.scanId = result.id;
    schedulePoll(0);
  } catch (error) { setBusy(false); notice(errorMessage(error)); }
}

function selectedCandidate() { return state.report?.candidates.find(item => item.id === $('source-select').value); }
function updateSource() {
  const candidate = selectedCandidate();
  $('source-description').textContent = candidate ? `${candidate.method} ${candidate.endpoint} · ${candidate.itemsPath}` : t('source.description');
  $('report-pagination').textContent = t('pagination.' + (candidate ? candidate.pagination : state.report?.actions.includes('page') ? 'nextPage' : state.report?.actions.includes('nextItem') ? 'nextItem' : state.report?.actions.includes('loadMore') ? 'loadMore' : 'scroll'));
  const paths = candidate?.filePaths || (!candidate ? ['images'] : []);
  $('download-files').disabled = !paths.length; if (!paths.length) $('download-files').checked = false;
  $('file-hint').textContent = paths.length ? t('files.paths', { paths: paths.join(', ') }) : t('files.none');
  $('scan-sample').textContent = sample(candidate?.sample || state.report?.sample || []);
  const autoMode = candidate && candidate.id === '0' ? state.report.recommendedMode : 'browser';
  $('strategy').options[0].textContent = t('strategy.autoMode', { mode: autoMode === 'api' ? 'API' : t('strategy.browserName') });
}

function renderReport(report, resetSelection = true) {
  const sourceId = $('source-select').value, strategy = $('strategy').value;
  state.report = report; $('report').hidden = false;
  $('capability').textContent = t('capability.' + report.capability); $('capability').className = `badge ${report.capability}`;
  $('report-message').textContent = message(report.messageData || report.message);
  $('report-responses').textContent = number(report.responses); $('report-records').textContent = number(report.observedRecords);
  $('report-warnings').textContent = (report.warningMessages || report.warnings).map(message).join(' ');
  const select = $('source-select'); select.replaceChildren();
  for (const candidate of report.candidates) { const option = document.createElement('option'); option.value = candidate.id; option.textContent = t('report.sourceCounts', { path: candidate.itemsPath, count: number(candidate.observedRecords) }) + (candidate.total != null ? t('report.sourceTotal', { total: number(candidate.total) }) : ''); select.append(option); }
  const domOption = document.createElement('option'); domOption.value = 'dom'; domOption.textContent = t('source.dom'); select.append(domOption);
  if (!resetSelection) select.value = sourceId;
  $('strategy').value = resetSelection ? 'auto' : strategy;
  $('start-job').disabled = state.starting || ['blocked', 'login', 'unknown'].includes(report.capability);
  updateSource();
}

async function startAuto() {
  try {
    state.starting = true; $('start-job').disabled = true; notice('');
    const candidateId = $('source-select').value;
    const mode = candidateId === 'dom' ? 'browser' : $('strategy').value === 'auto' && candidateId !== '0' ? 'browser' : $('strategy').value;
    const job = await api('/api/jobs', { scanId: state.scanId, candidateId, mode, limits: { maxRequests: Number($('max-requests').value) }, downloadFiles: $('download-files').checked });
    showNewJob(job); await refreshJobs(); schedulePoll(1200);
    if (matchMedia('(max-width:760px)').matches) $('activity-title').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  } catch (error) { notice(errorMessage(error)); }
  finally { state.starting = false; $('start-job').disabled = state.report && ['blocked', 'login', 'unknown'].includes(state.report.capability); }
}

function renderJobs() {
  const list = $('job-list');
  const filtered = Boolean(state.search || state.status);
  $('empty-jobs').hidden = state.jobs.length > 0 || filtered;
  $('no-matches').hidden = state.jobs.length > 0 || !filtered;
  $('history-page').textContent = t('history.page', { page: number(state.pagination.page), pages: number(state.pagination.pages), total: number(state.pagination.total) });
  $('history-prev').disabled = state.pagination.page <= 1;
  $('history-next').disabled = state.pagination.page >= state.pagination.pages;
  if (!state.selectedJob || !state.jobs.some(job => job.id === state.selectedJob)) state.selectedJob = state.jobs[0]?.id;
  const signature = JSON.stringify([state.language, state.selectedJob, state.jobs.map(job => [job.id, job.name, job.status, job.progress.items, job.progress.total])]);
  if (list.dataset.signature !== signature) {
    const focusedJob = document.activeElement?.closest('.job-select')?.dataset.jobId;
    list.replaceChildren(); list.dataset.signature = signature;
    for (const job of state.jobs) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `job-select${job.id === state.selectedJob ? ' selected' : ''}`; button.setAttribute('aria-pressed', String(job.id === state.selectedJob));
    button.dataset.jobId = job.id;
    const label = document.createElement('span'); label.className = 'job-label'; label.textContent = job.name;
    const count = document.createElement('span'); count.className = 'job-total'; count.textContent = `${number(job.progress.items)}` + (job.progress.total != null ? `/${number(job.progress.total)}` : '') + ` · ${t('status.' + job.status)}`;
    button.append(label, count); button.addEventListener('click', () => { state.selectedJob = job.id; renderJobs(); refreshJobs().catch(error => notice(errorMessage(error))); }); list.append(button);
    }
    if (focusedJob) [...list.children].find(button => button.dataset.jobId === focusedJob)?.focus({ preventScroll: true });
  }
  const job = state.detail?.id === state.selectedJob ? state.detail : null;
  $('job-detail').hidden = !job; if (!job) return;
  $('job-name').textContent = job.name; $('job-status').textContent = t('status.' + job.status); $('job-status').className = `badge ${job.status}`;
  $('job-stage').textContent = message(job.progress.stageMessage || job.progress.stage);
  $('job-items').textContent = number(job.progress.items) + (job.progress.total != null ? ` / ${number(job.progress.total)}` : ''); $('job-pages').textContent = number(job.progress.pages);
  $('job-requests').textContent = number(job.progress.requests); $('job-duplicates').textContent = number(job.progress.duplicates);
  const progress = $('job-progress');
  if (job.progress.total > 0) { progress.max = job.progress.total; progress.value = job.progress.items; }
  else if (job.status === 'completed') { progress.max = 1; progress.value = 1; }
  else progress.removeAttribute('value');
  $('job-meta').textContent = t('job.meta', { method: t(job.kind === 'api' ? 'job.api' : 'job.browser'), seconds: number(Math.floor(job.progress.elapsedMs / 1000)), files: number(job.progress.files) }) + (job.progress.total != null ? t('job.total', { total: number(job.progress.total) }) : t('job.unknownTotal'));
  $('job-error').textContent = message(job.errorMessage || job.error); $('job-error').hidden = !job.error;
  $('pause-job').hidden = job.status !== 'running'; $('resume-job').hidden = !['paused', 'limited', 'incomplete', 'failed'].includes(job.status);
  for (const format of ['json', 'jsonl', 'csv']) $('export-' + format).href = `/api/jobs/${job.id}/export/${format}`;
  if ($('output-path').value !== job.outputPath) $('output-path').value = job.outputPath;
  const log = $('job-log'), entries = job.logs.slice(-15), logSignature = JSON.stringify([state.language, entries]);
  if (log.dataset.signature !== logSignature) {
    const wasAtBottom = log.scrollHeight - log.clientHeight - log.scrollTop < 20;
    const previousScroll = log.scrollTop;
    log.replaceChildren(); log.dataset.signature = logSignature;
    for (const entry of entries) { const row = document.createElement('li'); const time = document.createElement('time'); time.dateTime = entry.at; time.textContent = new Date(entry.at).toLocaleTimeString(localeFor(state.language), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); const text = document.createElement('span'); text.textContent = message(entry.messageData || entry.message); row.append(time, text); log.append(row); }
    log.scrollTop = wasAtBottom ? log.scrollHeight : previousScroll;
  }
  const sampleText = sample(job.samples); if ($('job-sample').textContent !== sampleText) $('job-sample').textContent = sampleText;
}

function showNewJob(job) {
  state.selectedJob = job.id; state.detail = job; state.detailStamp = null;
  state.jobs = [job, ...state.jobs.filter(item => item.id !== job.id)].slice(0, 15);
  state.page = 1; state.search = ''; state.status = ''; state.historyVersion++;
  $('history-search').value = ''; $('history-status').value = '';
}
async function refreshJobs() {
  if (state.refreshTask) { state.refreshAgain = true; return state.refreshTask; }
  state.refreshTask = (async () => {
    do {
      state.refreshAgain = false;
      const version = state.historyVersion;
      const query = new URLSearchParams({ page: state.page, limit: 15, search: state.search, status: state.status });
      const result = await api('/api/jobs?' + query);
      if (version !== state.historyVersion) { state.refreshAgain = true; continue; }
      state.jobs = result.jobs; state.pagination = result.pagination; state.page = result.pagination.page; state.running = result.activity.running;
      if (!state.jobs.some(job => job.id === state.selectedJob)) state.selectedJob = state.jobs[0]?.id;
      const brief = state.jobs.find(job => job.id === state.selectedJob);
      if (brief) {
        const stamp = JSON.stringify([brief.id, brief.updatedAt, brief.status]);
        if (stamp !== state.detailStamp) {
          const detail = await api('/api/jobs/' + brief.id);
          if (version !== state.historyVersion || state.selectedJob !== brief.id) { state.refreshAgain = true; continue; }
          state.detail = detail;
          state.detailStamp = JSON.stringify([detail.id, detail.updatedAt, detail.status]);
        } else state.detail = { ...state.detail, ...brief };
      } else { state.detail = null; state.detailStamp = null; }
      renderJobs();
    } while (state.refreshAgain);
  })().finally(() => { state.refreshTask = null; });
  return state.refreshTask;
}
async function jobAction(action) {
  try { await api(`/api/jobs/${state.selectedJob}/${action}`, {}); state.detailStamp = null; await refreshJobs(); schedulePoll(1200); } catch (error) { notice(errorMessage(error)); }
}
let pollTimer;
function schedulePoll(delay) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, delay); }
function pollDelay() {
  if (document.hidden) return 60000;
  if (!state.connected) return 5000;
  return state.running || state.scanId && !state.report && !$('scan-progress').hidden ? 1200 : 15000;
}
async function poll() {
  if (state.polling) return; state.polling = true;
  try {
    await refreshJobs();
    if (state.scanId && !state.report && !$('scan-progress').hidden) {
      const current = await api(`/api/scans/${state.scanId}`);
      state.scanProgress = current.progress; renderScanProgress();
      if (current.status === 'completed') { setBusy(false); renderReport(current.report); }
      else if (current.status === 'failed') { setBusy(false); notice(current.errorMessage || current.error); }
    }
    state.connected = true; renderConnection();
  } catch { state.connected = false; renderConnection(); }
  finally { state.polling = false; schedulePoll(pollDelay()); }
}

async function importSource(selectedIndex) {
  try {
    const result = await api('/api/import', { source: $('import-text').value, selectedIndex });
    if (result.candidates) {
      const select = $('har-select'); select.replaceChildren();
      for (const item of result.candidates) { const option = document.createElement('option'); option.value = item.index; option.textContent = `${item.method} ${item.url}`; select.append(option); }
      $('har-field').hidden = false; return;
    }
    $('har-field').hidden = true;
    if (result.type === 'archive') {
      state.preview = { type: 'archive', result }; renderPreview();
      if (result.pageUrl) { $('site-url').value = result.pageUrl; await scan(); }
      notice(result.noticeMessage || result.notice, true);
      return;
    }
    const next = result.config || { ...structuredClone(baseConfig), request: result.request || { ...baseConfig.request, method: 'POST', body: result.body } };
    if (result.paths?.length) next.extract.itemsPath = result.paths[0].path;
    $('config-editor').value = JSON.stringify(next, null, 2);
    notice(result.noticeMessage || result.notice || msg('import.requestReady'), true);
  } catch (error) { notice(errorMessage(error)); }
}

$('scan-form').addEventListener('submit', event => { event.preventDefault(); scan(); });
$('site-url').addEventListener('input', () => { if (state.report && $('site-url').value.trim() !== state.report.url) { state.report = null; state.scanId = null; $('report').hidden = true; } });
for (const [id, route] of [['demo-infinite', '/demo/infinite'], ['demo-pages', '/demo/paginated']]) $(id).addEventListener('click', () => { $('site-url').value = location.origin + route; scan(); });
$('source-select').addEventListener('change', updateSource);
$('start-job').addEventListener('click', startAuto);
$('cancel-scan').addEventListener('click', async () => { try { await api(`/api/scans/${state.scanId}/cancel`, {}); } catch (error) { notice(errorMessage(error)); } });
$('pause-job').addEventListener('click', () => jobAction('pause')); $('resume-job').addEventListener('click', () => jobAction('resume'));
$('refresh-jobs').addEventListener('click', () => { state.detailStamp = null; refreshJobs().catch(error => notice(errorMessage(error))); });
let searchTimer;
$('history-search').addEventListener('input', () => {
  state.search = $('history-search').value; state.page = 1; state.historyVersion++;
  clearTimeout(searchTimer); searchTimer = setTimeout(() => refreshJobs().catch(error => notice(errorMessage(error))), 250);
});
$('history-status').addEventListener('change', () => {
  state.status = $('history-status').value; state.page = 1; state.historyVersion++;
  refreshJobs().catch(error => notice(errorMessage(error)));
});
for (const [id, step] of [['history-prev', -1], ['history-next', 1]]) $(id).addEventListener('click', () => {
  state.page = Math.max(1, Math.min(state.pagination.pages, state.page + step)); state.historyVersion++;
  refreshJobs().catch(error => notice(errorMessage(error)));
});
$('copy-path').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('output-path').value); state.copied = true; $('copy-path').textContent = t('downloads.copied'); setTimeout(() => { state.copied = false; $('copy-path').textContent = t('downloads.copy'); }, 1600); } catch { $('output-path').select(); notice(msg('clipboard.manual')); } });
$('import-button').addEventListener('click', () => importSource()); $('har-import').addEventListener('click', () => importSource(Number($('har-select').value)));
$('import-file').addEventListener('change', async event => { const file = event.target.files[0]; if (!file) return; if (file.size > 30 * 1024 * 1024) { notice(msg('import.fileTooLarge')); return; } $('import-text').value = await file.text(); await importSource(); });
$('preview-button').addEventListener('click', async () => {
  try { $('preview-button').disabled = true; const result = await api('/api/preview', config()); state.preview = { type: 'request', result }; renderPreview(); }
  catch (error) { notice(errorMessage(error)); } finally { $('preview-button').disabled = false; }
});
$('manual-start').addEventListener('click', async () => {
  try { $('manual-start').disabled = true; const job = await api('/api/jobs', { config: config() }); showNewJob(job); await refreshJobs(); schedulePoll(1200); notice(''); }
  catch (error) { notice(errorMessage(error)); } finally { $('manual-start').disabled = false; }
});
$('open-login').addEventListener('click', async () => {
  try { $('open-login').disabled = true; const result = await api('/api/browser/login', { url: $('site-url').value.trim() }); state.loginId = result.id; $('open-login').hidden = true; $('save-login').hidden = false; notice(msg('login.instructions'), true); }
  catch (error) { notice(errorMessage(error)); } finally { $('open-login').disabled = false; }
});
$('save-login').addEventListener('click', async () => {
  try { await api('/api/browser/save', { id: state.loginId }); state.loginId = null; $('save-login').hidden = true; $('open-login').hidden = false; await scan(); }
  catch (error) { notice(errorMessage(error)); }
});
for (const button of document.querySelectorAll('[data-language]')) button.addEventListener('click', () => setLanguage(button.dataset.language));
window.addEventListener('storage', event => { if (event.key === storageKey || event.key === null) setLanguage(readLanguage(), false); });
const workspace = new WorkspaceUI({ t, message, api, notice, getLanguage: () => state.language });
$('explore-job').addEventListener('click', () => workspace.guard(() => workspace.openJob(state.selectedJob)));
$('save-config').addEventListener('click', () => workspace.guard(() => { const value = config(); return workspace.prefill(value, value.request?.url, value.kind || 'api'); }));
$('save-analysis').addEventListener('click', () => workspace.guard(() => {
  const candidate = selectedCandidate(), report = state.report;
  const mode = $('strategy').value === 'api' || $('strategy').value === 'auto' && candidate?.id === '0' && report.recommendedMode === 'api' ? 'api' : 'browser';
  let value;
  if (mode === 'api') { if (!candidate?.apiConfig) throw new MessageError('scan.apiIncomplete'); value = { ...candidate.apiConfig, kind: 'api' }; }
  else value = { ...report.browserConfig, ...(candidate ? { source: candidate.source, extract: { itemsPath: candidate.itemsPath, uniqueKey: candidate.source.uniqueKey }, download: { ...report.browserConfig.download, paths: candidate.filePaths } } : { source: null, extract: { itemsPath: '$', uniqueKey: '_key' }, download: { ...report.browserConfig.download, paths: ['images'] } }) };
  return workspace.prefill({ ...value, limits: { ...value.limits, maxRequests: Number($('max-requests').value) }, download: { ...value.download, enabled: $('download-files').checked } }, report.url, mode);
}));
setLanguage(state.language, false);
document.addEventListener('visibilitychange', () => schedulePoll(document.hidden ? 60000 : 0));
window.addEventListener('online', () => schedulePoll(0));
window.addEventListener('pagehide', () => clearTimeout(pollTimer));
poll();
