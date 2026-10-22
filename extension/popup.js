import { translate } from './i18n.js';
const $ = id => document.getElementById(id);
let language = 'vi', state, activeTab, connection, busy = false, lastSamples = '', libraryUrl;
const t = (key, params) => translate(language, key, params);
async function send(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'readFailed');
  return result.result;
}
function showError(error) { $('error').textContent = t(error.message); $('error').hidden = false; }
async function action(work) {
  if (busy) return;
  busy = true; $('error').hidden = true; render();
  try { await work(); } catch (error) { showError(error); }
  finally { busy = false; await refresh(); }
}
function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function renderSamples() {
  const signature = JSON.stringify([language, state?.sample]);
  if (signature === lastSamples) return;
  lastSamples = signature; $('samples').replaceChildren();
  for (const record of state?.sample || []) {
    const article = element('article', null, 'sample');
    article.append(element('h3', record.title));
    if (record.body !== record.title) article.append(element('p', record.body));
    if (record.choices?.length) { const choices = element('ul'); for (const choice of record.choices) choices.append(element('li', choice)); article.append(choices); }
    if (state.kind === 'question') article.append(element('p', t('answer'), 'answer-label'), element('p', record.answer || t('noAnswer')));
    $('samples').append(article);
  }
}
function renderCollections() {
  const selected = $('collection').value, signature = JSON.stringify([language, connection?.collections]);
  if ($('collection').dataset.signature === signature) return;
  $('collection').dataset.signature = signature;
  const empty = element('option', t('unfiled')); empty.value = '';
  $('collection').replaceChildren(empty, ...(connection?.collections || []).map(value => { const option = element('option', value.name); option.value = String(value.id); return option; }));
  $('collection').value = selected;
}
function render() {
  document.documentElement.lang = language;
  document.querySelectorAll('[data-t]').forEach(node => { node.textContent = t(node.dataset.t); });
  $('language').textContent = language === 'vi' ? 'EN' : 'VI'; $('language').setAttribute('aria-label', language === 'vi' ? 'English' : 'Tiếng Việt');
  $('active-title').textContent = activeTab?.title || '';
  const supported = /^https?:\/\//.test(activeTab?.url || '');
  $('active-host').textContent = supported ? new URL(activeTab.url).hostname : '';
  $('unsupported').hidden = supported;
  $('start').disabled = busy || !supported || ['collecting', 'waiting', 'login', 'saving'].includes(state?.state);
  $('start').textContent = t(state ? 'readAgain' : 'read');
  $('connection').textContent = t(connection === undefined ? 'connecting' : connection ? 'connected' : 'disconnected');
  $('connection').parentElement.classList.toggle('connected', Boolean(connection)); $('help').hidden = Boolean(connection); $('connect').hidden = Boolean(connection);
  $('capture').hidden = !state;
  renderCollections();
  if (!state) return;
  const collecting = ['collecting', 'waiting', 'login'].includes(state.state), saved = state.state === 'saved';
  $('status').textContent = t(state.state); $('count').textContent = new Intl.NumberFormat(language).format(state.count);
  $('capture-title').textContent = state.source?.title || '';
  $('counts').textContent = state.expectedTotal == null ? t('count', { count: state.count }) + '. ' + t('unknown') : t('known', { count: state.count, total: state.expectedTotal });
  $('progress').hidden = !collecting && state.expectedTotal == null;
  if (state.expectedTotal) { $('progress').max = state.expectedTotal; $('progress').value = state.count; } else $('progress').removeAttribute('value');
  const reasons = ['permission', 'blocked', 'returnToSource', 'recovered', 'tabClosed', 'sourceChanged', 'limit', 'timeLimit'];
  $('reason').hidden = !reasons.includes(state.reason); if (!$('reason').hidden) $('reason').textContent = t(state.reason);
  $('completeness').hidden = !state.count || state.completeness === 'complete';
  $('completeness').textContent = t(state.completeness === 'partial' ? 'partial' : 'unknownWarning');
  $('pause').hidden = !collecting; $('pause').disabled = busy;
  $('resume').hidden = collecting || state.completeness === 'complete' || ['saved', 'saving'].includes(state.state); $('resume').disabled = busy;
  $('focus').hidden = !['waiting', 'login', 'paused'].includes(state.state);
  $('sample-details').hidden = !state.count; $('destination-area').hidden = !state.count || saved;
  $('save').disabled = busy || !state.count || state.state === 'saving';
  $('export').hidden = !state.count;
  $('open-library').hidden = !connection;
  renderSamples();
}
async function refresh() { try { state = await send('STATE'); render(); } catch (error) { showError(error); } }
async function connect() {
  connection = undefined; render();
  try { connection = await send('HEALTH'); libraryUrl = connection.url; $('error').hidden = true; }
  catch (error) { connection = null; showError(error); }
  render();
}
async function start() {
  $('replace').hidden = true;
  state = await send('START', { tabId: activeTab.id, mode: $('mode').value, autoMore: $('auto-more').checked }); render();
}
$('start').addEventListener('click', () => {
  if (state?.count && state.state !== 'saved') { $('replace').hidden = false; return; }
  action(start);
});
$('replace-yes').addEventListener('click', () => action(start)); $('replace-no').addEventListener('click', () => { $('replace').hidden = true; });
$('pause').addEventListener('click', () => action(() => send('PAUSE')));
$('resume').addEventListener('click', () => action(() => send('RESUME')));
$('focus').addEventListener('click', () => action(() => send('FOCUS')));
$('connect').addEventListener('click', () => action(connect));
$('language').addEventListener('click', async () => { language = language === 'vi' ? 'en' : 'vi'; await chrome.storage.local.set({ language }); render(); });
$('save').addEventListener('click', () => action(async () => {
  await send('PREVIEW');
  await send('SAVE', { collectionId: $('collection').value || null });
  await chrome.storage.local.set({ collectionId: $('collection').value });
}));
$('collection-form').addEventListener('submit', event => { event.preventDefault(); action(async () => { const value = await send('COLLECTION', { name: $('collection-name').value }); connection = await send('HEALTH'); renderCollections(); $('collection').value = String(value.id); $('collection-name').value = ''; }); });
$('open-library').addEventListener('click', () => { if (/^http:\/\/127\.0\.0\.1:\d+$/.test(libraryUrl || '')) chrome.tabs.create({ url: libraryUrl + '/#library' }); });
$('export').addEventListener('click', () => action(async () => {
  const snapshot = await send('EXPORT'), url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'cao-cao-capture.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.capture) refresh(); });
const settings = await chrome.storage.local.get(['language', 'collectionId']); language = settings.language || 'vi';
[activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
await refresh();
connect().then(() => { if (settings.collectionId) $('collection').value = settings.collectionId; });
setInterval(async () => { if (state?.state === 'saving') { try { const run = await send('IMPORT_STATUS'); if (run?.status === 'failed') showError(new Error(run.error?.code || 'readFailed')); } catch (error) { showError(error); } } }, 1000);
