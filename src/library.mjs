import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, stat, open, rename } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { httpUrl } from './config.mjs';
import { MessageError, errorMessage } from './messages.mjs';
import { fetchResponse, retryFetch } from './net.mjs';
import { scanWebsite } from './browser.mjs';
import { readLearningPage, questionFields, questionRecord } from './learning-extract.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const bounded = (value, length = 200) => { if (typeof value !== 'string' || value.length > length) throw new MessageError('learning.invalid'); return value.trim(); };
const canonicalUrl = value => { const url = httpUrl(value); url.hash = ''; for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key); return url.href; };

export class LearningLibrary {
  constructor(directory, manager, datasets, sessions, options = {}) { Object.assign(this, { directory, manager, datasets, sessions, options }); this.previews = new Map(); this.active = new Map(); this.pending = new Set(); this.controllers = new Set(); this.closing = false; }
  async init() {
    await mkdir(join(this.directory, 'files'), { recursive: true });
    this.path = join(this.directory, 'library.sqlite'); this.db = new DatabaseSync(this.path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS collections(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY,identity TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',url TEXT NOT NULL,author TEXT NOT NULL DEFAULT '',published_at TEXT NOT NULL DEFAULT '',saved_at TEXT NOT NULL,updated_at TEXT NOT NULL,collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,tags TEXT NOT NULL DEFAULT '[]',notes TEXT NOT NULL DEFAULT '',choices TEXT NOT NULL DEFAULT '[]',answer TEXT NOT NULL DEFAULT '',job_id TEXT,record_index INTEGER);
      CREATE INDEX IF NOT EXISTS items_collection ON items(collection_id,id); CREATE INDEX IF NOT EXISTS items_kind ON items(kind,id);
      CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(title,body,tags,notes,content='items',content_rowid='id',tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS item_insert AFTER INSERT ON items BEGIN INSERT INTO item_search(rowid,title,body,tags,notes) VALUES(new.id,new.title,new.body,new.tags,new.notes); END;
      CREATE TRIGGER IF NOT EXISTS item_delete AFTER DELETE ON items BEGIN INSERT INTO item_search(item_search,rowid,title,body,tags,notes) VALUES('delete',old.id,old.title,old.body,old.tags,old.notes); END;
      CREATE TRIGGER IF NOT EXISTS item_update AFTER UPDATE ON items BEGIN INSERT INTO item_search(item_search,rowid,title,body,tags,notes) VALUES('delete',old.id,old.title,old.body,old.tags,old.notes); INSERT INTO item_search(rowid,title,body,tags,notes) VALUES(new.id,new.title,new.body,new.tags,new.notes); END;
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,config TEXT NOT NULL,status TEXT NOT NULL,cursor INTEGER NOT NULL DEFAULT 0,items INTEGER NOT NULL DEFAULT 0,error TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments(id INTEGER PRIMARY KEY,item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,url TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,bytes INTEGER NOT NULL DEFAULT 0,etag TEXT,error TEXT,mime TEXT,UNIQUE(item_id,url));
      UPDATE imports SET status='paused' WHERE status='running'; UPDATE attachments SET status='paused' WHERE status='running';`);
    return this;
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  collection(id) { if (id == null || id === '') return null; const row = this.db.prepare('SELECT * FROM collections WHERE id=?').get(Number(id)); if (!row) throw new MessageError('learning.collectionMissing'); return row.id; }
  collections() { return this.db.prepare('SELECT c.*,count(i.id) AS items FROM collections c LEFT JOIN items i ON i.collection_id=c.id GROUP BY c.id ORDER BY c.name').all(); }
  saveCollection(input, id) {
    const name = bounded(input.name, 100); if (!name) throw new MessageError('learning.invalid');
    try { if (id) { this.collection(id); this.db.prepare('UPDATE collections SET name=? WHERE id=?').run(name, Number(id)); } else id = Number(this.db.prepare('INSERT INTO collections(name) VALUES (?)').run(name).lastInsertRowid); }
    catch (error) { if (error.code?.startsWith('ERR_SQLITE')) throw new MessageError('learning.collectionExists'); throw error; }
    return { id: Number(id), name };
  }
  deleteCollection(id) { this.collection(id);this.transaction(()=>{this.db.prepare("UPDATE imports SET config=json_set(config,'$.collectionId',NULL) WHERE json_extract(config,'$.collectionId')=?").run(Number(id));this.db.prepare('DELETE FROM collections WHERE id=?').run(Number(id));});for(const active of this.active.values())if(active.config?.collectionId===Number(id))active.config.collectionId=null;return {deleted:true}; }
  query(input = {}) {
    const page = Number(input.page || 1), limit = Number(input.limit || 24), kind = input.kind || '', search = bounded(input.search || '', 200), clauses = [], params = [];
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || kind && !['article','document','question'].includes(kind)) throw new MessageError('learning.invalid');
    if (kind) { clauses.push('kind=?'); params.push(kind); }
    if (input.collection) { clauses.push('collection_id=?'); params.push(this.collection(input.collection)); }
    if (search) { const terms = search.split(/\s+/).slice(0, 8).map(term => `"${term.replaceAll('"', '""')}"*`).join(' AND '); clauses.push('id IN (SELECT rowid FROM item_search WHERE item_search MATCH ?)'); params.push(terms); }
    if (input.tag) { clauses.push('EXISTS (SELECT 1 FROM json_each(items.tags) WHERE value=?)'); params.push(bounded(input.tag, 40)); }
    return { page, limit, where: clauses.length ? ' WHERE ' + clauses.join(' AND ') : '', params };
  }
  list(input) {
    const q = this.query(input), total = this.db.prepare('SELECT count(*) n FROM items' + q.where).get(...q.params).n, pages = Math.max(1, Math.ceil(total / q.limit)), page = Math.min(q.page, pages);
    const rows = this.db.prepare(`SELECT id,kind,title,url,author,saved_at,updated_at,collection_id,tags,substr(body,1,240) excerpt,(SELECT count(*) FROM attachments a WHERE a.item_id=items.id AND a.status='done') AS files,(SELECT count(*) FROM attachments a WHERE a.item_id=items.id AND a.status!='done') AS pending FROM items${q.where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...q.params,q.limit,(page-1)*q.limit).map(row => ({ ...row, tags: JSON.parse(row.tags) }));
    return { items: rows, pagination: { page, pages, total, limit: q.limit }, collections: this.collections(), imports: this.imports(), activeFiles: this.db.prepare("SELECT count(*) n FROM attachments WHERE status IN ('pending','running')").get().n };
  }
  item(id) {
    const row = this.db.prepare('SELECT * FROM items WHERE id=?').get(Number(id)); if (!row) throw new MessageError('learning.itemMissing');
    return { ...row, tags: JSON.parse(row.tags), choices: JSON.parse(row.choices), attachments: this.db.prepare('SELECT id,url,status,bytes,mime,error FROM attachments WHERE item_id=? ORDER BY id').all(row.id).map(file => ({ ...file, error: file.error ? JSON.parse(file.error) : null })) };
  }
  updateItem(id, input) {
    const row = this.item(id), title = input.title === undefined ? row.title : bounded(input.title, 300), notes = input.notes === undefined ? row.notes : bounded(input.notes, 30000), collection = input.collectionId === undefined ? row.collection_id : this.collection(input.collectionId), tags = input.tags ?? row.tags;
    if (!title || !Array.isArray(tags) || tags.length > 20) throw new MessageError('learning.invalid');
    const normalized = [...new Set(tags.map(tag => bounded(tag,40)).filter(Boolean))];
    this.db.prepare('UPDATE items SET title=?,notes=?,collection_id=?,tags=?,updated_at=? WHERE id=?').run(title,notes,collection,JSON.stringify(normalized),now(),Number(id)); return this.item(id);
  }
  deleteItem(id) { this.item(id); this.db.prepare('DELETE FROM items WHERE id=?').run(Number(id)); return { deleted: true }; }
  neighbors(id,input={}) {
    this.item(id);const q=this.query({...input,kind:'question'}),where=q.where||' WHERE 1=1',params=q.params;
    return {previous:this.db.prepare('SELECT id FROM items'+where+' AND id>? ORDER BY id LIMIT 1').get(...params,Number(id))?.id||null,next:this.db.prepare('SELECT id FROM items'+where+' AND id<? ORDER BY id DESC LIMIT 1').get(...params,Number(id))?.id||null,current:this.db.prepare('SELECT count(*) n FROM items'+where+' AND id>?').get(...params,Number(id)).n+1,total:this.db.prepare('SELECT count(*) n FROM items'+where).get(...params).n};
  }
  saveRecord(record, config, index) {
    const kind = config.kind, url = canonicalUrl(record.url || config.url), identity = digest(kind + '\0' + url + '\0' + (kind === 'question' ? record.sourceId || digest(JSON.stringify([record.body,record.choices])) : ''));
    const row = this.db.prepare(`INSERT INTO items(identity,kind,title,body,url,author,published_at,saved_at,updated_at,collection_id,choices,answer,job_id,record_index) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(identity) DO UPDATE SET body=excluded.body,choices=excluded.choices,answer=excluded.answer,updated_at=excluded.updated_at RETURNING id`).get(identity,kind,(record.title || 'Tài liệu').slice(0,300),record.body || '',url,record.author || '',record.publishedAt || '',now(),now(),config.collectionId || null,JSON.stringify(record.choices || []),record.answer || '',config.jobId || null,index ?? null);
    if (config.downloadFiles) for (const fileUrl of record.files || (kind === 'document' ? [url] : [])) {
      const valid = httpUrl(fileUrl,url).href, extension = extname(new URL(valid).pathname).toLowerCase(), path = digest(valid) + (/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '.bin');
      this.db.prepare("INSERT OR IGNORE INTO attachments(item_id,url,path,status) VALUES(?,?,?,'pending')").run(row.id,valid,path);
      if (kind === 'document') this.db.prepare("UPDATE attachments SET status='pending',error=NULL WHERE item_id=? AND url=? AND status='done' AND (etag IS NULL OR etag != ?)").run(row.id,valid,record.fileEtag||'');
    }
    return row.id;
  }
  imports() { return this.db.prepare('SELECT * FROM imports ORDER BY created_at DESC LIMIT 20').all().map(row => { const config = JSON.parse(row.config); return { id: row.id,status: row.status,cursor: row.cursor,items: row.items,error: row.error ? JSON.parse(row.error) : null,kind: config.kind,url: config.url,jobId: config.jobId || null }; }); }
  previewToken(value) { while (this.previews.size >= 8) this.previews.delete(this.previews.keys().next().value); const id = randomUUID(); this.previews.set(id,{ ...value,expires: Date.now()+600000 }); return id; }
  async jobPreview(jobId, input = {}) {
    const job = this.manager.get(jobId), records = [];
    for await (const entry of this.datasets.records(job)) { records.push(entry.record); if (records.length === 3) break; }
    if (!records.length) throw new MessageError('learning.questionMissing');
    const fields = input.fields || questionFields(records[0]), config = { kind: 'question',url: job.config.request.url,jobId,fields };
    return { token: this.previewToken({ ...config,mappingRecords: this.mappingRecords(records) }), kind: 'question',sample: records.map(record => questionRecord(record,fields)),fields,count: job.progress.items,availableFields: this.fieldNames(records[0]) };
  }
  mappingRecords(records) { if (Buffer.byteLength(JSON.stringify(records)) > 512*1024) throw new MessageError('learning.contentLimit');return records; }
  validateFields(fields) { for(const key of ['question','choices','answer','id'])if(typeof fields?.[key]!=='string'||fields[key].length>200)throw new MessageError('learning.invalid');return Object.fromEntries(['question','choices','answer','id'].map(key=>[key,fields[key]])); }
  remapPreview(token,input) {
    const preview=this.previews.get(token);if(!preview||preview.expires<Date.now())throw new MessageError('learning.previewExpired');
    if(preview.kind!=='question')throw new MessageError('learning.invalid');const fields=this.validateFields(input.fields),sample=preview.mappingRecords.map(record=>questionRecord(record,fields));preview.fields=fields;return {token,fields,sample};
  }
  fieldNames(record, prefix = '', depth = 0) { if (!record || typeof record !== 'object' || depth > 4) return []; return Object.entries(record).flatMap(([key,value]) => { const path = prefix ? prefix+'.'+key : key; return /^[\w$-]+$/.test(key) ? [path,...(!Array.isArray(value) ? this.fieldNames(value,path,depth+1) : [])] : []; }).slice(0,100); }
  async preview(input, signal) {
    const url = httpUrl(input.url).href, kind = input.kind || 'article'; if (!['article','document','question'].includes(kind)) throw new MessageError('learning.invalid');
    if (kind === 'question') {
      const report = await scanWebsite(url,this.sessions,()=>{},signal,this.options.scanOptions);
      if (['blocked','login','unknown'].includes(report.capability)) throw new MessageError(report.messageData);
      const sample = report.sample || [], fields = questionFields(sample[0] || {}), config = { kind,url,fields,jobConfig: report.recommendation };
      return { token: this.previewToken({ ...config,mappingRecords: this.mappingRecords(sample) }),kind,sample: sample.map(record => questionRecord(record,fields)),fields,count: report.total,availableFields: this.fieldNames(sample[0]) };
    }
    if (kind === 'document') {
      const { response } = await fetchResponse({ url,method:'HEAD',headers: await this.authHeaders(url) },{ timeoutMs:15000 },signal);
      await response.body?.cancel(); if (!response.ok && response.status !== 405) throw new MessageError('browser.http',{status:response.status});
      const record = { title: decodeURIComponent(new URL(url).pathname.split('/').at(-1)) || 'Tài liệu',url,body:'',files:[url],fileEtag:response.headers.get('etag') };
      return { token:this.previewToken({ kind,url,urls:[url],seed:record }),kind,sample:[record],count:1 };
    }
    const session = await this.sessions.open(url,{ signal,lightweight:true });
    try { const record = await readLearningPage(session.page,url,signal), urls = input.scope === 'list' ? [...new Set(record.links.filter(link => !/\.(pdf|docx?|xlsx?|pptx?)(?:[?#]|$)/i.test(link)))] : [url]; if (!urls.length) throw new MessageError('learning.noLinks'); return { token:this.previewToken({ kind,url,urls,seed: input.scope === 'list' ? null : record }),kind,sample:[record],count:urls.length,urls:urls.slice(0,5) }; }
    finally { await session.close(); }
  }
  startImport(input) {
    const preview = this.previews.get(input.token); if (!preview || preview.expires < Date.now()) throw new MessageError('learning.previewExpired');
    const { expires,mappingRecords, ...config } = preview; config.collectionId = this.collection(input.collectionId); config.downloadFiles = input.downloadFiles === true;
    if (input.fields && config.kind === 'question') config.fields=this.validateFields(input.fields);
    const id = randomUUID(); this.db.prepare("INSERT INTO imports(id,config,status,created_at) VALUES(?,?,'queued',?)").run(id,JSON.stringify(config),now()); this.kick(); return { id,status:'queued' };
  }
  async importAction(id, action) {
    const row = this.db.prepare('SELECT * FROM imports WHERE id=?').get(id); if (!row) throw new MessageError('learning.itemMissing');
    if (action === 'pause') { this.db.prepare("UPDATE imports SET status='paused' WHERE id=?").run(id); this.active.get(id)?.controller.abort(); await Promise.allSettled([this.active.get(id)?.promise]); }
    else { if (this.active.has(id) || !['paused','failed','incomplete'].includes(row.status)) throw new MessageError('learning.importBusy'); this.db.prepare("UPDATE imports SET status='queued',error=NULL WHERE id=?").run(id); this.kick(); }
    return { saved:true };
  }
  start() { if (!this.timer) { this.timer = setInterval(()=>this.kick(),500); this.timer.unref(); this.kick(); } }
  kick() {
    if (this.closing) return;
    if (!this.active.size && this.manager.slots.size < this.manager.maxRunning) {
      const row = this.db.prepare("SELECT * FROM imports WHERE status='queued' ORDER BY created_at LIMIT 1").get();
      if (row) {
        const owner = Symbol('learning-import'), controller = new AbortController(); this.manager.admit(owner); this.db.prepare("UPDATE imports SET status='running' WHERE id=?").run(row.id);
        const active = { controller }; this.active.set(row.id,active);
        active.promise = this.runImport(row,controller.signal,owner).catch(error => { this.db.prepare('UPDATE imports SET status=?,error=? WHERE id=?').run(controller.signal.aborted?'paused':'failed',controller.signal.aborted?null:JSON.stringify(errorMessage(error)),row.id); }).finally(()=>{this.manager.release(owner);this.active.delete(row.id);});
      }
    }
    if (!this.fileActive && this.manager.slots.size < this.manager.maxRunning) {
      const file = this.db.prepare("SELECT * FROM attachments WHERE status='pending' ORDER BY id LIMIT 1").get();
      if (file) {
        const owner = Symbol('learning-file'), controller = new AbortController(); this.manager.admit(owner); this.db.prepare("UPDATE attachments SET status='running' WHERE id=?").run(file.id);
        this.fileActive = { controller,promise:this.download(file,controller.signal).catch(error=>this.db.prepare('UPDATE attachments SET status=?,error=? WHERE id=?').run(controller.signal.aborted?'paused':'failed',controller.signal.aborted?null:JSON.stringify(errorMessage(error)),file.id)).finally(()=>{this.manager.release(owner);this.fileActive=null;}) };
      }
    }
  }
  async runImport(row,signal,owner) {
    const config = JSON.parse(row.config); let cursor = row.cursor, count = row.items, session;this.active.get(row.id).config=config;
    const commit = records => this.transaction(()=>{ for (const record of records) { this.saveRecord(record,config,cursor); cursor++; count++; } this.db.prepare('UPDATE imports SET cursor=?,items=? WHERE id=?').run(cursor,count,row.id); });
    try {
      if (config.kind === 'question') {
        let job;
        if (!config.jobId) { job = await this.manager.create({ ...config.jobConfig,download:{...config.jobConfig.download,enabled:false} }); config.jobId=job.id; this.db.prepare('UPDATE imports SET config=? WHERE id=?').run(JSON.stringify(config),row.id); }
        else job=this.manager.get(config.jobId);
        if (job.status !== 'completed' && config.jobConfig) {
          const abort=()=>job.pause(); signal.addEventListener('abort',abort,{once:true});
          try { job.start(owner,{retainReservation:true}); await job.promise; } finally { signal.removeEventListener('abort',abort); }
        }
        signal.throwIfAborted(); let batch=[];
        for await (const entry of this.datasets.records(job)) { signal.throwIfAborted(); if(entry.index<cursor)continue; batch.push(questionRecord(entry.record,config.fields)); if(batch.length>=100){commit(batch);batch=[];await new Promise(resolve=>setImmediate(resolve));} }
        if(batch.length)commit(batch);
        this.db.prepare('UPDATE imports SET status=? WHERE id=?').run(job.status==='completed'?'completed':'incomplete',row.id);
      } else {
        if(config.kind==='article')session=await this.sessions.open(config.url,{signal,lightweight:true});
        for(;cursor<config.urls.length;){signal.throwIfAborted();const url=config.urls[cursor],record=cursor===0&&config.seed?config.seed:config.kind==='document'?{title:decodeURIComponent(new URL(url).pathname.split('/').at(-1))||'Tài liệu',body:'',url,files:[url]}:await readLearningPage(session.page,url,signal);commit([record]);}
        this.db.prepare("UPDATE imports SET status='completed' WHERE id=?").run(row.id);
      }
    } finally { await session?.close(); }
  }
  async authHeaders(url) {
    if(!this.sessions.statePath)return {};
    try { const state=JSON.parse(await readFile(this.sessions.statePath(url),'utf8')), target=httpUrl(url),cookies=(state.cookies||[]).filter(cookie=>{const domain=cookie.domain.replace(/^\./,''),path=cookie.path||'/';return (target.hostname===domain||cookie.domain.startsWith('.')&&target.hostname.endsWith('.'+domain))&&(target.pathname===path||target.pathname.startsWith(path.endsWith('/')?path:path+'/'))&&(!cookie.secure||target.protocol==='https:')&&(cookie.expires<0||cookie.expires>Date.now()/1000);});return cookies.length?{cookie:cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ')}:{}; }catch{return {};}
  }
  async download(file,signal) {
    const target=join(this.directory,'files',file.path),part=target+'.part',headers=await this.authHeaders(file.url),limits={timeoutMs:30000,retries:3};
    let offset=0,etag;
    const request={url:file.url,method:'GET',get headers(){try{offset=statSync(part).size;}catch{offset=0;}return {...headers,'accept-encoding':'identity',...(offset&&etag&&!etag.startsWith('W/')?{range:`bytes=${offset}-`,'if-range':etag}:{})};}};
    etag=file.etag;
    await retryFetch(request,limits,signal,null,async response=>{
      const currentTag=response.headers.get('etag'),range=response.headers.get('content-range'),partial=response.status===206;
      if(partial&&(!offset||!etag||etag!==currentTag||!range?.startsWith(`bytes ${offset}-`)))throw new MessageError('learning.fileInvalid');
      etag=currentTag;this.db.prepare('UPDATE attachments SET etag=? WHERE id=?').run(etag,file.id);
      const handle=await open(part,partial?'a':'w');let bytes=partial?offset:0;
      try {for await(const chunk of response.body||[]){signal.throwIfAborted();bytes+=chunk.length;if(bytes>100*1024*1024)throw new MessageError('download.tooLarge');await handle.writeFile(chunk);}await handle.sync();}finally{await handle.close();}
      const total=partial?Number(range.split('/').at(-1)):response.headers.get('content-encoding')?0:Number(response.headers.get('content-length'));
      if(total&&bytes!==total)throw new MessageError('learning.fileInvalid');
      if(file.path.endsWith('.pdf')){const handle=await open(part,'r'),head=Buffer.alloc(5);try{await handle.read(head,0,5,0);}finally{await handle.close();}if(head.toString()!=='%PDF-')throw new MessageError('learning.fileInvalid');}
      await rename(part,target);this.db.prepare("UPDATE attachments SET status='done',bytes=?,etag=?,mime=?,error=NULL WHERE id=?").run(bytes,response.headers.get('etag'),response.headers.get('content-type')||'application/octet-stream',file.id);
    });
  }
  file(id) {const row=this.db.prepare('SELECT * FROM attachments WHERE id=?').get(Number(id));if(!row||row.status!=='done')throw new MessageError('learning.fileMissing');return {...row,target:join(this.directory,'files',row.path)};}
  retryFiles(id) {this.item(id);this.db.prepare("UPDATE attachments SET status='pending',error=NULL WHERE item_id=? AND status IN ('failed','paused')").run(Number(id));this.kick();return {saved:true};}
  async *exportRows(input={}) {
    const q=this.query(input),db=new DatabaseSync(this.path,{readOnly:true});db.exec('BEGIN');
    try {for(const row of db.prepare('SELECT * FROM items'+q.where+' ORDER BY id').iterate(...q.params)){yield {...row,tags:JSON.parse(row.tags),choices:JSON.parse(row.choices)};}}finally{db.exec('ROLLBACK');db.close();}
  }
  close(){if(this.closePromise)return this.closePromise;this.closing=true;clearInterval(this.timer);this.closePromise=(async()=>{for(const controller of this.controllers)controller.abort();for(const active of this.active.values())active.controller.abort();this.fileActive?.controller.abort();await Promise.allSettled([...this.active.values()].map(a=>a.promise).concat(this.fileActive?.promise||[],[...this.pending]));this.db.close();})();return this.closePromise;}
}
