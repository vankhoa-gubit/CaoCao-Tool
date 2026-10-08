import { arrayPaths, getAt, normalizeConfig, pathParts } from './config.mjs';

export function leaves(value, prefix = '', out = [], depth = 0) {
  if (depth > 8) return out;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) if (/^[\w$-]+$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)) leaves(child, prefix ? `${prefix}.${key}` : key, out, depth + 1);
  } else if (!Array.isArray(value)) out.push({ path: prefix, name: prefix.split('.').at(-1)?.replace(/[_-]/g, '').toLowerCase(), value });
  return out;
}

const pageNames = ['page', 'pagenumber', 'pageindex', 'pageno', 'p'];
const offsetNames = ['offset', 'skip', 'startindex'];
const cursorNames = ['cursor', 'after', 'continuation', 'continuationtoken', 'nexttoken', 'pagetoken'];
const batchNames = ['batch', 'batchid', 'cluster', 'clusterid', 'group', 'groupid', 'chunk', 'chunkid'];
const nextCursorNames = ['nextcursor', 'endcursor', 'nexttoken', 'continuationtoken', 'nextpagetoken'];
const nextBatchNames = ['nextbatch', 'nextbatchid', 'nextcluster', 'nextclusterid', 'nextgroup', 'nextgroupid', 'nextchunk'];
const moreNames = ['hasmore', 'hasnext', 'hasnextpage', 'hasmorepages', 'hasnextpages'];
const batchMoreNames = ['hasmorebatches', 'hasnextbatch', 'hasnextgroup', 'hasmoregroups', 'hasnextcluster'];
const totalNames = ['total', 'totalcount', 'totalitems', 'totalrecords', 'totalquestions', 'questioncount', 'totalcards'];

// Prefer metadata beside this array, then ancestor metadata containers. Other
// collections in the same response must not supply this collection's flags.
export function metadataFields(response, itemsPath = '$') {
  const parts = pathParts(itemsPath); parts.pop();
  const result = [], seen = new Set();
  const add = fields => { for (const field of fields) if (!seen.has(field.path)) { seen.add(field.path); result.push(field); } };
  while (true) {
    const parent = getAt(response, parts.join('.'));
    for (const [key, value] of Object.entries(parent || {})) {
      const path = [...parts, key].join('.');
      if (value === null || typeof value !== 'object') add(leaves(value, path));
      else if (/^(meta|pagination|pageInfo|paging)$/i.test(key)) add(leaves(value, path));
    }
    if (!parts.length) break;
    parts.pop();
  }
  return result;
}

export function collectionMetadata(response, itemsPath) {
  const fields = metadataFields(response, itemsPath);
  const total = fields.find(item => totalNames.includes(item.name) && Number.isSafeInteger(item.value) && item.value >= 0);
  const more = fields.find(item => moreNames.includes(item.name) && typeof item.value === 'boolean');
  return { total: total?.value ?? null, totalPath: total?.path || '', hasMore: more?.value, hasMorePath: more?.path || '' };
}

function parameters(capture) {
  return [
    ...[...new URL(capture.url).searchParams].map(([path, value]) => ({ path, value, name: path.replace(/[_-]/g, '').toLowerCase(), location: 'query' })),
    ...leaves(capture.body).map(item => ({ ...item, location: 'body' })),
  ];
}

export function inferPagination(captures, itemsPath = arrayPaths(captures[0]?.response)[0]?.path || '$') {
  const first = captures[0];
  const params = captures.flatMap(parameters);
  const responseFields = metadataFields(first.response, itemsPath);
  const find = names => params.find(item => names.includes(item.name));
  const findResponse = names => responseFields.find(item => names.includes(item.name));
  const page = find(pageNames), offset = find(offsetNames), cursor = find(cursorNames), batch = find(batchNames);
  const more = responseFields.find(item => moreNames.includes(item.name) && typeof item.value === 'boolean');
  const nextCursor = findResponse(nextCursorNames);
  const nextOffset = findResponse(['nextoffset', 'nextskip', 'nextstartindex']);
  const responseOffset = findResponse(offsetNames);
  const nextUrl = responseFields.find(item => ['next', 'nexturl', 'nextpageurl'].includes(item.name) && (item.value === null || typeof item.value === 'string' && /^(https?:\/\/|\/|\?)/.test(item.value)));
  const size = find(['limit', 'pagesize', 'perpage', 'count', 'first']);
  const base = parameters(first);
  const startValue = parameter => base.find(item => item.path === parameter.path && item.location === parameter.location)?.value;
  let pagination = { mode: 'none' };
  if (cursor && nextCursor) pagination = { mode: 'cursor', param: cursor.path, location: cursor.location, start: startValue(cursor) ?? null, nextPath: nextCursor.path };
  else if (nextUrl) pagination = { mode: 'nextUrl', nextPath: nextUrl.path };
  else if (page && /^\d+$/.test(String(startValue(page)))) pagination = { mode: 'page', param: page.path, location: page.location, start: Number(startValue(page)), step: 1 };
  else if (offset && /^\d+$/.test(String(startValue(offset) ?? responseOffset?.value ?? (nextOffset ? 0 : undefined)))) {
    const observed = captures.map(c => parameters(c).find(item => item.path === offset.path)?.value).map(Number);
    const step = observed.find(value => value > observed[0]) - observed[0];
    const responseSize = findResponse(['limit', 'pagesize', 'batchsize']);
    const count = getAt(first.response, itemsPath)?.length || 20;
    // A captured request is often a prefetch from the user's current window,
    // not the beginning of the collection. URL discovery downloads the full list.
    pagination = { mode: 'offset', param: offset.path, location: offset.location, start: 0, step: Number.isFinite(step) && step > 0 ? step : Number(size?.value || responseSize?.value) || count, nextPath: nextOffset?.path || '' };
  }
  if (more) pagination.hasMorePath = more.path;
  const total = responseFields.find(item => totalNames.includes(item.name) && Number.isSafeInteger(item.value) && item.value >= 0);
  if (total) pagination.totalPath = total.path;
  if (size && /^\d+$/.test(String(size.value)) && Number(size.value) > 0) { pagination.pageSize = Number(size.value); pagination.sizeParam = size.path; }
  else {
    const responseSize = findResponse(['limit', 'pagesize', 'batchsize']);
    if (Number.isSafeInteger(responseSize?.value) && responseSize.value > 0) pagination.pageSize = responseSize.value;
  }
  const nextBatch = findResponse(nextBatchNames), batchMore = findResponse(batchMoreNames);
  if (batch && page && (nextBatch || batchMore)) pagination = { ...pagination, mode: 'batch', param: page.path, location: page.location, start: /^\d+$/.test(String(startValue(page))) ? Number(startValue(page)) : 1, batch: { param: batch.path, location: batch.location, start: startValue(batch) ?? null, nextPath: nextBatch?.path || '', hasMorePath: batchMore?.path || '' } };
  return pagination;
}

export function analyzeCaptures(captures, signals = {}) {
  const grouped = new Map();
  for (const capture of captures) {
    const url = new URL(capture.url);
    if (/analytics|telemetry|tracking|\/collect\b|doubleclick|google-analytics/i.test(url.hostname + url.pathname)) continue;
    for (const info of arrayPaths(capture.response)) {
      const records = getAt(capture.response, info.path);
      if (!records.length || !records.some(item => item && typeof item === 'object' && !Array.isArray(item))) continue;
      const key = `${capture.method}:${url.origin}${url.pathname}:${info.path}`;
      if (!grouped.has(key)) grouped.set(key, { path: info.path, captures: [], count: 0, score: 0, sample: records.slice(0, 3) });
      const group = grouped.get(key);
      group.captures.push(capture); group.count += records.length;
      const contentFields = Object.keys(records.find(item => item && typeof item === 'object') || {}).filter(field => /title|name|text|content|description|url|link|node/i.test(field)).length;
      group.score = Math.max(group.score, records.length + contentFields * 15) + 2;
    }
  }
  const groups = [...grouped.values()];
  const candidates = groups.map(group => {
    const capture = group.captures[0];
    const pagination = inferPagination(group.captures, group.path);
    const metadata = collectionMetadata(capture.response, group.path);
    const uniqueKey = ['id', '_id', 'questionId', 'cardId', 'node.id', 'uuid', 'url', 'link'].find(key => group.sample.every(record => getAt(record, key) != null)) || '';
    const source = { origin: new URL(capture.url).origin, pathname: new URL(capture.url).pathname, method: capture.method, itemsPath: group.path, uniqueKey, ...metadata, pagination: pagination.mode, pageSize: pagination.pageSize || 0 };
    // A session identifier in a bootstrap response is evidence for binding this
    // path to a fresh session on the next browser visit; never wildcard all IDs.
    const segments = source.pathname.split('/');
    if (uniqueKey && pagination.mode !== 'none') {
      for (const seed of groups) {
        const seedCapture = seed.captures[0], seedUrl = new URL(seedCapture.url);
        if (seed === group || seedUrl.origin !== source.origin || !seed.sample.every(item => getAt(item, uniqueKey) != null)) continue;
        const shape = Object.keys(group.sample[0]);
        if (!shape.every(key => Object.hasOwn(seed.sample[0], key))) continue;
        const sessionId = leaves(seedCapture.response).find(item => item.name === 'sessionid' && ['string', 'number'].includes(typeof item.value));
        const index = sessionId ? segments.indexOf(String(sessionId.value)) : -1;
        if (index < 1) continue;
        source.seed = { origin: seedUrl.origin, pathname: seedUrl.pathname, method: seedCapture.method, itemsPath: seed.path, sessionIdPath: sessionId.path };
        source.sessionPathIndex = index;
        break;
      }
    }
    const filePaths = leaves(group.sample[0]).filter(item => /image|thumbnail|fileurl|downloadurl|pdf|video/i.test(item.name) && typeof item.value === 'string' && /^https?:\/\//.test(item.value)).map(item => item.path);
    let apiConfig = null;
    try { apiConfig = normalizeConfig({ name: signals.title || 'Dữ liệu từ trang web', request: { url: capture.url, method: capture.method, headers: capture.headers, body: capture.body, bodyType: capture.bodyType || 'json' }, extract: { itemsPath: group.path, uniqueKey }, pagination, download: { paths: filePaths } }); } catch { /* A nonstandard request remains available through the browser. */ }
    return {
      endpoint: source.origin + source.pathname, method: capture.method,
      itemsPath: group.path, observedRecords: group.count, responses: group.captures.length, sample: group.sample,
      pagination: pagination.mode, apiConfig, total: metadata.total,
      source, filePaths,
      score: group.score + (apiConfig && pagination.mode !== 'none' ? 200 : 0) + (capture.method === 'GET' ? 20 : 0),
    };
  });
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8).map(({ score, ...candidate }, index) => ({ id: String(index), ...candidate }));
}
