import { msg, MessageError, fields } from './messages.mjs';
import { arrayPaths, httpUrl, getAt } from './config.mjs';
import { collectionMetadata, metadataFields } from './detect.mjs';

export function tokenizeCurl(source) {
  const input = source.replace(/(?:\\|\^|`)\r?\n/g, ' ');
  const tokens = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '^' && quote !== "'" && i + 1 < input.length) { word += input[++i]; started = true; continue; }
    if (char === '\\' && quote !== "'" && i + 1 < input.length && (!quote || /["\\$`]/.test(input[i + 1]))) { word += input[++i]; started = true; continue; }
    if (quote) {
      if (char === quote) quote = '';
      else word += char;
      started = true;
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { tokens.push(word); word = ''; started = false; } }
    else { word += char; started = true; }
  }
  if (quote) throw new MessageError('curl.quote');
  if (started) tokens.push(word);
  return tokens;
}

export function parseCurl(source) {
  const tokens = tokenizeCurl(source);
  if (!/^curl(?:\.exe)?$/i.test(tokens.shift() || '')) throw new MessageError('curl.start');
  let url, method, asGet = false;
  const headers = {}, data = [];
  const take = index => { if (tokens[index] === undefined) throw new MessageError('curl.value'); return tokens[index]; };
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], inline;
    const equal = token.indexOf('=');
    if (token.startsWith('--') && equal > 0) { inline = token.slice(equal + 1); token = token.slice(0, equal); }
    const value = () => inline === undefined ? take(++i) : inline;
    if (['-X', '--request'].includes(token)) method = value();
    else if (/^-X.+/.test(token)) method = token.slice(2);
    else if (['-H', '--header'].includes(token) || /^-H.+/.test(token)) {
      const raw = token.startsWith('-H') && token.length > 2 ? token.slice(2) : value();
      const colon = raw.indexOf(':');
      if (colon < 1) throw new MessageError('curl.header');
      headers[raw.slice(0, colon).trim().toLowerCase()] = raw.slice(colon + 1).trim();
    } else if (['-b', '--cookie'].includes(token)) {
      const cookie = value(); if (cookie.startsWith('@') || !cookie.includes('=')) throw new MessageError('curl.cookie'); headers.cookie = cookie;
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--json', '--data-urlencode'].includes(token)) {
      const raw = value();
      if (raw.startsWith('@') && token !== '--data-raw') throw new MessageError('curl.file');
      data.push(token === '--data-urlencode' ? (() => { const at = raw.indexOf('='); return at < 0 ? encodeURIComponent(raw) : `${raw.slice(0, at)}=${encodeURIComponent(raw.slice(at + 1))}`; })() : raw);
      if (token === '--json') { headers['content-type'] = 'application/json'; headers.accept = 'application/json'; }
    } else if (token === '--url') url = value();
    else if (['-G', '--get'].includes(token)) asGet = true;
    else if (['--compressed', '-L', '--location', '-s', '--silent', '-S', '--show-error', '--globoff'].includes(token)) { /* transport options do not become commands */ }
    else if (['-A', '--user-agent', '-e', '--referer'].includes(token)) headers[token === '-A' || token === '--user-agent' ? 'user-agent' : 'referer'] = value();
    else if (token.startsWith('-')) throw new MessageError('curl.option', { option: token });
    else if (!url && /^https?:\/\//i.test(token)) url = token;
    else throw new MessageError('curl.content');
  }
  const parsedUrl = httpUrl(url);
  let body = data.length ? data.join('&') : null;
  if (asGet && body !== null) { for (const [key, value] of new URLSearchParams(body)) parsedUrl.searchParams.append(key, value); body = null; }
  let bodyType = headers['content-type']?.includes('json') || (body && /^[\[{]/.test(body.trim())) ? 'json' : body ? 'form' : 'raw';
  if (bodyType === 'json') { try { body = JSON.parse(body); } catch { throw new MessageError('curl.json'); } }
  return { url: parsedUrl.href, method: (method || (body !== null ? 'POST' : 'GET')).toUpperCase(), headers, body, bodyType };
}

export function inspectArchive(json) {
  if (!Array.isArray(json?.items) || !Array.isArray(json?.response?.captures)) return null;
  const uniqueKey = json.items.length ? ['questionId', 'cardId', 'id', '_id', 'node.id', 'uuid'].find(key => json.items.every(item => getAt(item, key) != null)) || '' : '';
  const ids = new Set(json.items.map(item => uniqueKey ? String(getAt(item, uniqueKey)) : JSON.stringify(item)));
  const sources = json.response.captures.flatMap(capture => arrayPaths(capture.response).map(info => {
    const records = getAt(capture.response, info.path);
    if (!Array.isArray(records) || !records.some(item => item && typeof item === 'object' && !Array.isArray(item))) return null;
    const matches = records.filter(item => ids.has(uniqueKey ? String(getAt(item, uniqueKey)) : JSON.stringify(item))).length;
    if (!matches) return null;
    const metadata = collectionMetadata(capture.response, info.path), fields = metadataFields(capture.response, info.path);
    return { endpoint: capture.url, method: capture.method || null, itemsPath: info.path, observedRecords: records.length, matches, ...metadata, offset: fields.find(field => field.name === 'offset')?.value ?? null, nextOffset: fields.find(field => field.name === 'nextoffset')?.value ?? null, pageSize: fields.find(field => ['limit', 'batchsize', 'pagesize'].includes(field.name))?.value ?? null };
  }).filter(Boolean)).sort((a, b) => b.matches - a.matches);
  const main = sources[0];
  let pageUrl = null;
  try { if (json.position?.pageUrl) pageUrl = httpUrl(json.position.pageUrl).href; } catch { /* An archive without a usable page URL is still inspectable. */ }
  const summary = { observedRecords: json.items.length, uniqueKey, total: main?.total ?? null, hasMore: main?.hasMore ?? null, offset: main?.offset ?? null, nextOffset: main?.nextOffset ?? null, pageSize: main?.pageSize ?? null };
  const counts = summary.total != null ? `${summary.observedRecords}/${summary.total}` : String(summary.observedRecords);
  return { type: 'archive', pageUrl, summary, sources, sample: json.items.slice(0, 3), ...fields(msg(`archive.${summary.hasMore === true ? 'more' : 'end'}.${pageUrl ? 'url' : 'manual'}`, { count: counts }), 'notice') };
}

export function importInput(source, selectedIndex) {
  if (typeof source !== 'string' || source.length > 30 * 1024 * 1024) throw new MessageError('import.invalid');
  if (/^\s*curl(?:\.exe)?\s/i.test(source)) return { request: parseCurl(source), type: 'curl' };
  let json;
  try { json = JSON.parse(source); } catch { throw new MessageError('import.format'); }
  const archive = inspectArchive(json);
  if (archive) return archive;
  if (json.log?.entries) {
    const choices = json.log.entries.map((entry, index) => ({ entry, index })).filter(({entry}) => ['GET', 'POST'].includes(entry.request?.method) && /json/i.test(entry.response?.content?.mimeType || '')).slice(0, 100);
    if (!choices.length) throw new MessageError('har.empty');
    if (selectedIndex === undefined) return { type: 'har', candidates: choices.map(({entry, index}) => ({ index, method: entry.request.method, url: entry.request.url, status: entry.response.status })) };
    const found = choices.find(choice => choice.index === Number(selectedIndex));
    if (!found) throw new MessageError('har.notFound');
    const req = found.entry.request;
    const headers = Object.fromEntries((req.headers || []).filter(h => !h.name.startsWith(':')).map(h => [h.name.toLowerCase(), h.value]));
    if (!headers.cookie && req.cookies?.length) headers.cookie = req.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const content = found.entry.response.content;
    let sample;
    try { sample = JSON.parse(content.encoding === 'base64' ? Buffer.from(content.text || '', 'base64').toString('utf8') : content.text || ''); } catch { /* HAR may omit response bodies */ }
    return { type: 'har', request: { url: req.url, method: req.method, headers, body: req.postData?.text ?? null, bodyType: /json/i.test(req.postData?.mimeType || '') ? 'json' : /urlencoded/i.test(req.postData?.mimeType || '') ? 'form' : 'raw' }, paths: sample ? arrayPaths(sample) : [] };
  }
  if (json.request?.url) return { type: 'config', config: json, request: json.request };
  if (json.url) return { type: 'request', request: json };
  return { type: 'payload', body: json, ...fields(msg('import.payloadReady'), 'notice') };
}
