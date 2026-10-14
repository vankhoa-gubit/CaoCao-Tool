import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { getAt } from './config.mjs';
import { canonical, csvValue, completionEvidence, checkPage } from './jobs.mjs';
import { MessageError } from './messages.mjs';
import { DatabaseSync } from 'node:sqlite';
import { datasetIndex, indexedRecord } from './data-index.mjs';

const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const empty = value => value == null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length;
const stamp = job => `${job.id}:${job.progress.pages}:${job.status}:${job.updatedAt}`;
const snapshot = job => ({ id: job.id, directory: job.directory, config: job.config, status: job.status, updatedAt: job.updatedAt, progress: { ...job.progress }, hasMore: job.hasMore, completionEvidence: job.completionEvidence });

export function valueAt(record, column) {
  if (column === '$') return record;
  if (record != null && Object.hasOwn(Object(record), column)) return record[column];
  try { return getAt(record, column); } catch { return undefined; }
}

export function dataQuery(input = {}) {
  const page = Number(input.page ?? 1), limit = Number(input.limit ?? 25), search = String(input.search ?? '').trim();
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || search.length > 500) throw new MessageError('data.query');
  let columns = input.columns;
  if (typeof columns === 'string') { try { columns = JSON.parse(columns); } catch { throw new MessageError('data.query'); } }
  if (columns != null && (!Array.isArray(columns) || columns.length > 200 || columns.some(column => typeof column !== 'string' || !column || column.length > 200 || column.split(/[.\[\]]/).some(part => forbidden.has(part))))) throw new MessageError('data.query');
  return { page, limit, search, columns: columns == null ? null : [...new Set(columns)] };
}

function project(record, columns) {
  return Object.fromEntries(columns.map(column => [column, valueAt(record, column) ?? null]));
}
function preview(value) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value ?? null;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
}

export function completeness(job, lastPage) {
  if (job.status !== 'completed') return { level: 'partial', confirmed: false, total: job.progress.total ?? null };
  const total = job.config.pagination.mode !== 'batch' && job.config.source?.pagination !== 'batch' ? job.progress.total : null;
  if (Number.isSafeInteger(total) && total >= 0 && job.progress.items >= total) return { level: 'total', confirmed: true, total };
  const evidence = job.completionEvidence || lastPage?.completionEvidence || (lastPage?.response && job.config.kind !== 'browser' ? completionEvidence(job.config, lastPage.response, lastPage.nextState) : null);
  // Browser batches use an outer end flag; inner page totals must not imply completeness.
  if (evidence?.type === 'sourceEnd' || job.hasMore === false && job.config.source?.pagination !== 'batch') return { level: 'sourceEnd', confirmed: true, total: total ?? null, path: evidence?.path || '' };
  return { level: 'unverified', confirmed: false, total: total ?? null };
}

export class DatasetService {
  constructor(manager) { this.manager = manager; this.qualityCache = new Map(); this.compareCache = new Map(); }
  cache(map, key, promise) {
    map.set(key, promise); if (map.size > 4) map.delete(map.keys().next().value);
    promise.catch(() => map.delete(key)); return promise;
  }
  async *pages(job, count = job.progress.pages) {
    for (let index = 1; index <= count; index++) yield checkPage(JSON.parse(await readFile(join(job.directory, 'pages', `${String(index).padStart(8, '0')}.json`), 'utf8')));
  }
  async *records(job, count = job.progress.pages) {
    let index = 0;
    for await (const page of this.pages(job, count)) for (let i = 0; i < page.items.length; i++) yield { index: index++, record: page.items[i], key: page.keys?.[i] };
  }
  async browse(id, input = {}) {
    const job = this.manager.get(id), query = dataQuery(input), pageCount = job.progress.pages, brief = job.summary({ detail: false });
    const available = new Set(job.config.exportFields || []), selected = query.columns;
    const index = await datasetIndex(job,pageCount);
    try {
      const search=query.search.toLocaleLowerCase(),where='page<=?'+(search?' AND instr(search,?)>0':''),params=search?[pageCount,search]:[pageCount];
      const all=index.db.prepare('SELECT count(*) n FROM records WHERE page<=?').get(pageCount).n,total=index.db.prepare('SELECT count(*) n FROM records WHERE '+where).get(...params).n;
      for(const row of index.db.prepare('SELECT DISTINCT name FROM fields WHERE page<=? LIMIT 200').all(pageCount))if(available.size<200&&row.name.length<=200&&!row.name.split(/[.\[\]]/).some(part=>forbidden.has(part)))available.add(row.name);
      const pages=Math.max(1,Math.ceil(total/query.limit)),page=Math.min(query.page,pages),metadata=index.db.prepare('SELECT ordinal,page,offset FROM records WHERE '+where+' ORDER BY ordinal LIMIT ? OFFSET ?').all(...params,query.limit,(page-1)*query.limit),rows=[];
      const pageCache={};for(const row of metadata)rows.push(await indexedRecord(job,row,pageCache));
      const columns=selected||(job.config.exportFields?.length?job.config.exportFields:[...available].slice(0,8));
      return {job:brief,columns,availableColumns:[...available],rows:rows.map(entry=>({index:entry.index,values:columns.map(column=>preview(valueAt(entry.record,column)))})),pagination:{page,pages,total,all,limit:query.limit},snapshotPages:pageCount};
    } finally { index.db.close(); }
  }
  async record(id, index) {
    index = Number(index); if (!Number.isSafeInteger(index) || index < 0) throw new MessageError('data.query');
    const job=this.manager.get(id),cache=await datasetIndex(job);
    try{const row=cache.db.prepare('SELECT ordinal,page,offset FROM records WHERE ordinal=? AND page<=?').get(index,job.progress.pages);if(!row)throw new MessageError('data.recordMissing');const entry=await indexedRecord(job,row);return {index,record:entry.record};}finally{cache.db.close();}
  }
  async *export(id, format, input = {}) {
    if (!['json', 'jsonl', 'csv'].includes(format)) throw new MessageError('export.format');
    const query = dataQuery(input), job = this.manager.get(id), pageCount = job.progress.pages;
    let columns = query.columns;
    if (format === 'csv' && columns === null) {
      const union = new Set();
      for await (const { record } of this.records(job, pageCount)) for (const key of record && typeof record === 'object' && !Array.isArray(record) ? Object.keys(record) : ['$']) union.add(key);
      columns = [...union];
    }
    if (format === 'csv') yield '\uFEFF' + columns.map(csvValue).join(',') + '\r\n';
    if (format === 'json') yield '[\n';
    let first = true;
    for await (const { record } of this.records(job, pageCount)) {
      if (query.search && !JSON.stringify(record).toLocaleLowerCase().includes(query.search.toLocaleLowerCase())) continue;
      const output = columns === null ? record : project(record, columns);
      if (format === 'csv') yield columns.map(column => csvValue(valueAt(record, column))).join(',') + '\r\n';
      else if (format === 'jsonl') yield JSON.stringify(output) + '\n';
      else { yield (first ? '' : ',\n') + JSON.stringify(output); first = false; }
    }
    if (format === 'json') yield '\n]\n';
  }
  rawQuality(job) {
    job = snapshot(job);
    const key = stamp(job); if (this.qualityCache.has(key)) return this.qualityCache.get(key);
    return this.cache(this.qualityCache, key, this.computeQuality(job));
  }
  async computeQuality(job) {
    const count = job.progress.pages, fields = new Map(), required = job.config.requiredFields || [];
    let records = 0, requiredRecordErrors = 0, fileErrorCount = 0, truncated = false, lastPage;
    const fileErrors = [];
    const add = path => {
      if (!fields.has(path)) { if (fields.size >= 500) { truncated = true; return; } fields.set(path, { path, present: 0, empty: 0, types: {}, required: required.includes(path) }); }
    };
    for (const path of required) add(path);
    const discover = (value, prefix = '', depth = 0) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const name of Object.keys(value)) {
          if (forbidden.has(name)) continue;
          const path = prefix ? `${prefix}.${name}` : name;
          if (path.length <= 200) add(path);
          if (depth < 5 && value[name] && typeof value[name] === 'object' && !Array.isArray(value[name])) discover(value[name], path, depth + 1);
        }
      } else if (!prefix) add('$');
    };
    for await (const page of this.pages(job, count)) {
      lastPage = page;
      fileErrorCount += page.fileErrors?.length || 0;
      for (const error of page.fileErrors || []) if (fileErrors.length < 100) fileErrors.push({ ...error, page: page.index });
      for (const record of page.items) {
        records++; discover(record);
        if (required.some(path => empty(valueAt(record, path)))) requiredRecordErrors++;
        for (const field of fields.values()) {
          const value = valueAt(record, field.path); if (value === undefined) continue;
          field.present++; if (empty(value)) field.empty++;
          const type = typeOf(value); field.types[type] = (field.types[type] || 0) + 1;
        }
      }
    }
    return { jobId: job.id, recordCount: records, fields: [...fields.values()].map(field => ({ ...field, missing: records - field.present })), fieldsTruncated: truncated, requiredRecordErrors, fileErrorCount, fileErrors, completeness: completeness(job, lastPage) };
  }
  async quality(id) {
    const job = this.manager.get(id), report = await this.rawQuality(job);
    const baseline = [...this.manager.jobs.values()].filter(other => job.config.sourceId && other.config.sourceId === job.config.sourceId && (other.createdAt < job.createdAt || other.createdAt === job.createdAt && other.id < job.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
    if (!baseline) return { ...report, schema: null };
    const before = await this.rawQuality(baseline), current = new Map(report.fields.filter(field => field.present).map(field => [field.path, Object.keys(field.types).sort().join(',')]));
    const old = new Map(before.fields.filter(field => field.present).map(field => [field.path, Object.keys(field.types).sort().join(',')]));
    return { ...report, schema: { baseId: baseline.id, confirmed: before.completeness.confirmed && report.completeness.confirmed, added: [...current.keys()].filter(path => !old.has(path)), missing: [...old.keys()].filter(path => !current.has(path)), changedTypes: [...current.keys()].filter(path => old.has(path) && old.get(path) !== current.get(path)).map(path => ({ path, before: old.get(path), after: current.get(path) })) } };
  }
  async compare(id, baseId, input = {}) {
    const job = this.manager.get(id), base = this.manager.get(baseId);
    if (id === baseId || !job.config.sourceId || job.config.sourceId !== base.config.sourceId || job.config.extract.uniqueKey !== base.config.extract.uniqueKey) throw new MessageError('compare.invalid');
    const { page: requestedPage, limit } = dataQuery(input), type = input.type || '';
    if (!['', 'added', 'changed', 'missing'].includes(type)) throw new MessageError('data.query');
    const key = `${stamp(job)}:${stamp(base)}`;
    const result = await (this.compareCache.get(key) || this.cache(this.compareCache, key, this.computeCompare(snapshot(job), snapshot(base))));
    const db=new DatabaseSync(result.dbPath,{readOnly:true});
    try{const where=type?' WHERE type=?':'',params=type?[type]:[],total=db.prepare('SELECT count(*) n FROM changes'+where).get(...params).n,pages=Math.max(1,Math.ceil(total/limit)),page=Math.min(requestedPage,pages),rows=db.prepare('SELECT type,key,currentIndex,baseIndex FROM changes'+where+" ORDER BY CASE WHEN type='missing' THEN 1 ELSE 0 END,coalesce(currentIndex,baseIndex) LIMIT ? OFFSET ?").all(...params,limit,(page-1)*limit).map(row=>({...row,key:JSON.parse(row.key)})),{dbPath,...summary}=result;return {...summary,rows,pagination:{page,pages,total,limit}};}finally{db.close();}
  }
  async computeCompare(job, base) {
    const current=await datasetIndex(job),baseline=await datasetIndex(base),dbPath=join(job.directory,'compare-'+digest([stamp(job),stamp(base)]).slice(0,24)+'.sqlite');current.db.close();baseline.db.close();
    const db=new DatabaseSync(dbPath);let counts;
    try{
      db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-16384; PRAGMA busy_timeout=5000;');
      db.prepare('ATTACH DATABASE ? AS current').run(current.path);db.prepare('ATTACH DATABASE ? AS baseline').run(baseline.path);
      db.exec('PRAGMA current.cache_size=-32768; PRAGMA baseline.cache_size=-32768;');
      db.exec('CREATE TABLE IF NOT EXISTS changes(type TEXT,key TEXT,currentIndex INTEGER,baseIndex INTEGER); DELETE FROM changes; BEGIN IMMEDIATE;');
      db.prepare("INSERT INTO changes SELECT 'added',c.label,c.ordinal,NULL FROM current.records c LEFT JOIN baseline.records b ON b.key=c.key AND b.page<=? WHERE c.page<=? AND b.key IS NULL").run(base.progress.pages,job.progress.pages);
      db.prepare("INSERT INTO changes SELECT 'changed',c.label,c.ordinal,b.ordinal FROM current.records c JOIN baseline.records b ON b.key=c.key WHERE c.page<=? AND b.page<=? AND c.hash!=b.hash").run(job.progress.pages,base.progress.pages);
      db.prepare("INSERT INTO changes SELECT 'missing',b.label,NULL,b.ordinal FROM baseline.records b LEFT JOIN current.records c ON c.key=b.key AND c.page<=? WHERE b.page<=? AND c.key IS NULL").run(job.progress.pages,base.progress.pages);
      counts={added:0,changed:0,missing:0,unchanged:db.prepare('SELECT count(*) n FROM current.records c JOIN baseline.records b ON b.key=c.key WHERE c.page<=? AND b.page<=? AND c.hash=b.hash').get(job.progress.pages,base.progress.pages).n};
      for(const row of db.prepare('SELECT type,count(*) n FROM changes GROUP BY type').all())counts[row.type]=row.n;
      db.exec('COMMIT');
    }finally{db.close();}
    const [currentQuality, baseQuality] = await Promise.all([this.rawQuality(job), this.rawQuality(base)]);
    return { jobId: job.id, baseId: base.id, counts, missingConfirmed: currentQuality.completeness.confirmed && baseQuality.completeness.confirmed, stableIdentity: Boolean(job.config.extract.uniqueKey && job.config.extract.uniqueKey !== '_key'), dbPath };
  }
}
