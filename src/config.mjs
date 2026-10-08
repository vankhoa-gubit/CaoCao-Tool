import { msg, MessageError } from './messages.mjs';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export function pathParts(value = '') {
  if (typeof value !== 'string') throw new MessageError('path.type');
  const clean = value.trim().replace(/^\$\.?/, '');
  if (!clean) return [];
  if (!/^[\w$-]+(?:\[\d+\]|\.[\w$-]+)*$/.test(clean)) {
    throw new MessageError('path.invalid', { path: value });
  }
  const parts = clean.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (parts.some(part => forbidden.has(part))) throw new MessageError('path.unsupported');
  return parts;
}

export function getAt(object, value) {
  return pathParts(value).reduce((current, part) => current != null && Object.hasOwn(Object(current), part) ? current[part] : undefined, object);
}

export function setAt(object, value, newValue) {
  const parts = pathParts(value);
  if (!parts.length) throw new MessageError('pagination.paramEmpty');
  let current = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] == null) current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    if (typeof current[part] !== 'object') throw new MessageError('path.write', { path: part });
    current = current[part];
  }
  if (newValue === undefined) delete current[parts.at(-1)];
  else current[parts.at(-1)] = newValue;
}

export function httpUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw new MessageError('url.invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new MessageError('url.protocol');
  }
  return url;
}

function integer(value, fallback, min, max, label) {
  const result = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new MessageError('config.integer', { label, min, max });
  return result;
}

function string(value, fallback = '') { return value == null ? fallback : String(value).trim(); }

export function normalizeConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MessageError('config.object');
  const req = input.request || {};
  const url = httpUrl(req.url).href;
  const method = string(req.method, 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) throw new MessageError('request.method');
  const headers = {};
  if (req.headers != null && (typeof req.headers !== 'object' || Array.isArray(req.headers))) throw new MessageError('headers.object');
  for (const [key, value] of Object.entries(req.headers || {})) {
    // HTTP/2 transport metadata from browser captures is not an HTTP header.
    if ([':authority', ':method', ':path', ':scheme'].includes(key.toLowerCase())) continue;
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || /[\r\n]/.test(String(value))) throw new MessageError('headers.invalid');
    if (!['host', 'content-length', 'connection', 'accept-encoding', 'transfer-encoding'].includes(key.toLowerCase())) headers[key.toLowerCase()] = String(value);
  }
  let body = req.body ?? null;
  const bodyType = string(req.bodyType, typeof body === 'object' && body !== null ? 'json' : 'raw');
  if (!['json', 'form', 'raw'].includes(bodyType)) throw new MessageError('payload.type');
  if (typeof body === 'string' && bodyType === 'json') {
    try { body = JSON.parse(body || '{}'); } catch { throw new MessageError('payload.json'); }
  }
  if (bodyType === 'form' && typeof body === 'string') body = Object.fromEntries(new URLSearchParams(body));
  if (['json', 'form'].includes(bodyType) && body != null && (typeof body !== 'object' || Array.isArray(body))) throw new MessageError('payload.object');
  if (method === 'GET' && body != null && body !== '') throw new MessageError('request.getBody');
  const raw = input.pagination || {};
  const mode = string(raw.mode, 'none');
  if (!['none', 'page', 'offset', 'cursor', 'nextUrl', 'batch'].includes(mode)) throw new MessageError('pagination.mode');
  const location = string(raw.location, 'query');
  if (!['query', 'body'].includes(location)) throw new MessageError('pagination.location');
  const param = string(raw.param, mode === 'cursor' ? 'cursor' : mode === 'offset' ? 'offset' : 'page');
  const p = {
    mode, location, param,
    start: mode === 'cursor' ? (raw.start === '' || raw.start == null ? null : raw.start) : integer(raw.start, mode === 'offset' ? 0 : 1, 0, 1e9, msg('label.start')),
    step: integer(raw.step, mode === 'offset' ? (raw.pageSize || 20) : 1, 1, 1e6, msg('label.step')),
    pageSize: integer(raw.pageSize, 0, 0, 1e6, msg('label.pageSize')),
    sizeParam: string(raw.sizeParam),
    nextPath: string(raw.nextPath, mode === 'cursor' ? 'pagination.nextCursor' : mode === 'nextUrl' ? 'pagination.next' : ''),
    hasMorePath: string(raw.hasMorePath),
    totalPath: string(raw.totalPath),
    stopOnShortPage: raw.stopOnShortPage === true,
  };
  const batch = raw.batch || {};
  p.batch = {
    location: string(batch.location, location), param: string(batch.param, 'batch'),
    start: Object.hasOwn(batch, 'start') ? batch.start : 1, step: integer(batch.step, 1, 1, 1e6, msg('label.batchStep')),
    nextPath: string(batch.nextPath), hasMorePath: string(batch.hasMorePath),
  };
  const extract = { itemsPath: string(input.extract?.itemsPath, 'data.items'), uniqueKey: string(input.extract?.uniqueKey) };
  for (const candidate of [extract.itemsPath, extract.uniqueKey, p.nextPath, p.hasMorePath, p.totalPath, p.batch.nextPath, p.batch.hasMorePath]) pathParts(candidate);
  for (const target of mode === 'batch' ? [p, p.batch] : [p]) {
    if (!['query', 'body'].includes(target.location)) throw new MessageError('pagination.batchLocation');
    if (!['none', 'nextUrl'].includes(mode) && !target.param) throw new MessageError('pagination.paramRequired');
    if (!['none', 'nextUrl'].includes(mode) && target.location === 'body') {
      pathParts(target.param);
      if (method !== 'POST' || bodyType !== 'json') throw new MessageError('pagination.body');
    }
  }
  if (p.sizeParam && p.location === 'body') pathParts(p.sizeParam);
  if (mode === 'nextUrl' && method !== 'GET') throw new MessageError('pagination.nextGet');
  if (['cursor', 'nextUrl'].includes(mode) && !p.nextPath) throw new MessageError('pagination.nextPath');
  if (mode === 'batch' && !p.batch.nextPath && !p.batch.hasMorePath) throw new MessageError('pagination.batchEnd');
  if (mode === 'batch' && p.batch.nextPath === '' && !Number.isSafeInteger(Number(p.batch.start))) throw new MessageError('pagination.batchToken');
  const limits = input.limits || {};
  const download = input.download || {};
  const paths = Array.isArray(download.paths) ? download.paths.map(value => string(value)).filter(Boolean) : [];
  paths.forEach(value => pathParts(value));
  if (download.enabled && !paths.length) throw new MessageError('download.paths');
  return {
    name: string(input.name, 'Nguồn dữ liệu').slice(0, 100) || 'Nguồn dữ liệu',
    request: { url, method, headers, body, bodyType }, extract, pagination: p,
    limits: {
      maxRequests: integer(limits.maxRequests, 200, 1, 10000, msg('label.maxRequests')),
      maxActions: integer(limits.maxActions, 10000, 1, 100000, msg('label.maxActions')),
      maxItems: integer(limits.maxItems, 0, 0, 1e7, msg('label.maxItems')),
      delayMs: integer(limits.delayMs, 300, 0, 60000, msg('label.delay')),
      timeoutMs: integer(limits.timeoutMs, 30000, 100, 300000, msg('label.timeout')),
      retries: integer(limits.retries, 3, 0, 8, msg('label.retries')),
      maxResponseBytes: integer(limits.maxResponseBytes, 20 * 1024 * 1024, 1024, 200 * 1024 * 1024, msg('label.maxResponse')),
    },
    download: { enabled: Boolean(download.enabled), paths, maxFileBytes: integer(download.maxFileBytes, 50 * 1024 * 1024, 1024, 500 * 1024 * 1024, msg('label.maxFile')) },
    saveRaw: input.saveRaw !== false,
  };
}

export function initialState(config) { return { value: config.pagination.start, batch: config.pagination.batch.start, nextUrl: null, rawCount: 0 }; }

export function buildRequest(config, state) {
  const p = config.pagination;
  const url = httpUrl(state.nextUrl || config.request.url);
  if (url.origin !== httpUrl(config.request.url).origin) throw new MessageError('pagination.crossOrigin');
  const body = structuredClone(config.request.body);
  const draft = body == null && config.request.bodyType === 'json' ? {} : body;
  const apply = (location, key, value) => {
    if (location === 'query') {
      if (value === null || value === undefined) url.searchParams.delete(key);
      else url.searchParams.set(key, String(value));
    } else setAt(draft, key, value == null ? undefined : value);
  };
  if (!['none', 'nextUrl'].includes(p.mode)) apply(p.location, p.param, state.value);
  if (p.pageSize && p.sizeParam) apply(p.location, p.sizeParam, p.pageSize);
  if (p.mode === 'batch') apply(p.batch.location, p.batch.param, state.batch);
  const headers = { accept: 'application/json', ...config.request.headers };
  let serialized;
  if (draft != null && config.request.method === 'POST') {
    if (config.request.bodyType === 'json') { serialized = JSON.stringify(draft); headers['content-type'] ??= 'application/json'; }
    else if (config.request.bodyType === 'form') { serialized = new URLSearchParams(draft).toString(); headers['content-type'] ??= 'application/x-www-form-urlencoded'; }
    else serialized = String(draft);
  }
  return { url: url.href, method: config.request.method, headers, body: serialized };
}

function flag(response, field) {
  if (!field) return undefined;
  const value = getAt(response, field);
  if (typeof value !== 'boolean') throw new MessageError('pagination.flag', { field });
  return value;
}

function token(response, field) {
  const value = getAt(response, field);
  if (value === undefined) throw new MessageError('pagination.missing', { field });
  if (value !== null && !['string', 'number'].includes(typeof value)) throw new MessageError('pagination.token', { field });
  return value === '' ? null : value;
}

export function nextState(config, state, response, count, requestUrl) {
  const p = config.pagination;
  if (p.mode === 'none') return null;
  const hasMore = flag(response, p.hasMorePath);
  const total = p.totalPath ? getAt(response, p.totalPath) : null;
  if (p.totalPath && (!Number.isSafeInteger(total) || total < 0)) throw new MessageError('pagination.total', { field: p.totalPath });
  const next = { ...state, rawCount: state.rawCount + count };
  if (p.mode === 'cursor' || p.mode === 'nextUrl') {
    if (hasMore === false) return null;
    const value = token(response, p.nextPath);
    if (value === null) {
      if (hasMore === true) throw new MessageError('pagination.noNext');
      return null;
    }
    if (p.mode === 'cursor') {
      if (String(value) === String(state.value)) throw new MessageError('pagination.cursorLoop');
      next.value = value;
    } else {
      const url = httpUrl(value, requestUrl);
      if (url.origin !== httpUrl(config.request.url).origin) throw new MessageError('pagination.crossOrigin');
      next.nextUrl = url.href;
    }
    return next;
  }
  const end = hasMore === false || (hasMore === undefined && (count === 0 || (p.stopOnShortPage && p.pageSize > 0 && count < p.pageSize) || total !== null && next.rawCount >= total));
  if (!end) {
    if (p.mode === 'offset' && p.nextPath) {
      const value = token(response, p.nextPath);
      if (!Number.isSafeInteger(value) || value <= Number(state.value)) throw new MessageError('pagination.offsetLoop');
      next.value = value;
    } else next.value = Number(state.value) + p.step;
    return next;
  }
  if (p.mode !== 'batch') return null;
  const moreBatches = flag(response, p.batch.hasMorePath);
  if (moreBatches === false) return null;
  const newBatch = p.batch.nextPath ? token(response, p.batch.nextPath) : Number(state.batch) + p.batch.step;
  if (newBatch === null) {
    if (moreBatches === true) throw new MessageError('pagination.noBatch');
    return null;
  }
  if (String(newBatch) === String(state.batch)) throw new MessageError('pagination.batchLoop');
  return { ...next, value: p.start, batch: newBatch, rawCount: 0 };
}

export function arrayPaths(value, prefix = '', depth = 0, result = []) {
  if (depth > 8 || result.length >= 40) return result;
  if (Array.isArray(value)) { result.push({ path: prefix || '$', count: value.length }); return result; }
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (/^[\w$-]+$/.test(key) && !forbidden.has(key)) arrayPaths(child, prefix ? `${prefix}.${key}` : key, depth + 1, result);
  }
  return result;
}
