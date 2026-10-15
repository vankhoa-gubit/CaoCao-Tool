import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createApp,listen,projectRoot} from '../src/server.mjs';
import {demoPdf} from '../src/learning-demo.mjs';
let app,origin,remote,fixture,directory;const slowSockets=new Set();
async function request(path,body,method){const response=await fetch(origin+path,{method:method||(body===undefined?'GET':'POST'),...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return {response,value:await response.json()};}
async function until(read,predicate,ms=15000){const end=Date.now()+ms;for(;;){const value=await read();if(predicate(value))return value;if(Date.now()>end)throw new Error('Expected preview state not reached');await new Promise(resolve=>setTimeout(resolve,30));}}
// Library rows that a preview must never create.
const footprint=()=>({items:app.library.db.prepare('SELECT count(*) n FROM items').get().n,imports:app.library.db.prepare('SELECT count(*) n FROM imports').get().n,attachments:app.library.db.prepare('SELECT count(*) n FROM attachments').get().n});
before(async()=>{
  await mkdir(join(projectRoot,'.qa'),{recursive:true});directory=await mkdtemp(join(projectRoot,'.qa','library-preview-'));
  fixture=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/slow-article'){slowSockets.add(res);res.setHeader('Content-Type','text/html; charset=utf-8');res.write('<!doctype html><title>Chậm</title>');return;}
    if(url.pathname==='/quiz')return res.end('<!doctype html><meta charset="utf-8"><title>Bộ câu không rõ tổng</title><main id="q"></main><script>fetch("/quiz-api?page=1").then(r=>r.json()).then(d=>{document.getElementById("q").textContent=d.items.map(i=>i.prompt).join(" | ")})</script>');
    if(url.pathname==='/quiz-api'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[{id:'a',prompt:'Câu thứ nhất?',answer:'Một'},{id:'b',prompt:'Câu thứ hai?',answer:'Hai'}],hasMore:false}));}
    if(url.pathname==='/manual.pdf'){const body=demoPdf();res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':body.length,'ETag':'"manual"','Last-Modified':'Tue, 01 Sep 2026 08:00:00 GMT'});return res.end(req.method==='HEAD'?undefined:body);}
    res.statusCode=404;res.end('missing');
  });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));remote=`http://127.0.0.1:${fixture.address().port}`;
  app=await createApp({dataDirectory:directory,scanOptions:{rounds:1,waitMs:300}});origin=await listen(app,0);
});
after(async()=>{for(const socket of slowSockets)socket.destroy();await app?.close();await new Promise(resolve=>fixture.close(resolve));});

test('Article, list, PDF and question previews describe the real source without touching the library',async()=>{
  const before=footprint();
  const article=(await request('/api/library/preview',{url:origin+'/demo/learning/article/1',kind:'article'})).value;
  assert.equal(article.method,'page');assert.equal(article.count,1);assert.equal(article.sample[0].title,'Đọc có chủ đích');assert.equal(article.sample[0].links,undefined);
  assert.equal(article.source.title,'Đọc có chủ đích');assert.equal(article.revision,1);assert.ok(Date.parse(article.expiresAt)>Date.now());
  assert.deepEqual(article.dataFields.find(field=>field.key==='body'),{key:'body',present:true});assert.equal(article.dataFields.find(field=>field.key==='author').present,false);
  const list=(await request('/api/library/preview',{url:origin+'/demo/learning/articles',kind:'article',scope:'list'})).value;
  assert.equal(list.method,'list');assert.equal(list.count,3);assert.equal(list.urls.length,3);assert.equal(list.source.title,'Tủ sách học tập');
  assert.deepEqual(list.sample.map(item=>item.title),['Đọc có chủ đích','Ôn tập cách quãng']);assert.ok(list.sample[1].body.includes('câu hỏi ngắn'));
  const pdf=(await request('/api/library/preview',{url:remote+'/manual.pdf',kind:'document'})).value;
  assert.equal(pdf.method,'file');assert.equal(pdf.document.fileName,'manual.pdf');assert.equal(pdf.document.contentType,'application/pdf');assert.equal(pdf.document.bytes,demoPdf().length);assert.ok(pdf.document.lastModified.includes('2026'));assert.deepEqual(pdf.warnings,[]);
  const questions=(await request('/api/library/preview',{url:remote+'/quiz',kind:'question'})).value;
  assert.equal(questions.count,null);assert.equal(questions.sample.length,2);assert.equal(questions.sample[0].body,'Câu thứ nhất?');assert.equal(questions.fields.question,'prompt');assert.ok(questions.availableFields.includes('answer'));assert.ok(['api','browser'].includes(questions.method));
  assert.deepEqual(footprint(),before);
});

test('Expired, unknown and discarded tokens never create an import',async()=>{
  const before=footprint(),preview=async()=>(await request('/api/library/preview',{url:origin+'/demo/learning/article/2',kind:'article'})).value;
  const expired=await preview();app.library.previews.get(expired.token).expires=Date.now()-1;
  let result=await request('/api/library/imports',{token:expired.token,revision:expired.revision});assert.equal(result.response.status,400);assert.equal(result.value.errorMessage.code,'learning.previewExpired');
  result=await request('/api/library/imports',{token:'00000000-0000-0000-0000-000000000000'});assert.equal(result.value.errorMessage.code,'learning.previewInvalid');
  result=await request('/api/library/imports',{});assert.equal(result.value.errorMessage.code,'learning.previewInvalid');
  const discarded=await preview();assert.deepEqual((await request('/api/library/previews/'+discarded.token,undefined,'DELETE')).value,{discarded:true});
  result=await request('/api/library/imports',{token:discarded.token,revision:discarded.revision});assert.equal(result.value.errorMessage.code,'learning.previewInvalid');
  assert.deepEqual(footprint(),before);
});

test('Confirmation must match the viewed mapping; retrying a confirmation returns the original import',async()=>{
  const preview=(await request('/api/library/preview',{url:remote+'/quiz',kind:'question'})).value,before=footprint();
  const remapped=(await request(`/api/library/previews/${preview.token}/mapping`,{fields:{...preview.fields,answer:'id'}})).value;assert.equal(remapped.revision,2);assert.equal(remapped.sample[0].answer,'a');
  let result=await request('/api/library/imports',{token:preview.token,revision:1,fields:remapped.fields});assert.equal(result.response.status,409);assert.equal(result.value.errorMessage.code,'learning.previewChanged');
  result=await request('/api/library/imports',{token:preview.token,revision:2,fields:preview.fields});assert.equal(result.response.status,409);assert.deepEqual(footprint(),before);
  const first=await request('/api/library/imports',{token:preview.token,revision:2,fields:remapped.fields});assert.equal(first.response.status,202);
  const retry=await request('/api/library/imports',{token:preview.token,revision:2,fields:remapped.fields});assert.equal(retry.response.status,200);assert.equal(retry.value.id,first.value.id);assert.equal(retry.value.duplicate,true);
  const run=await until(()=>app.library.imports().find(row=>row.id===first.value.id),row=>['completed','incomplete','failed'].includes(row.status),60000);
  assert.equal(run.status,'completed');assert.equal(run.items,2);assert.equal(app.library.db.prepare('SELECT count(*) n FROM imports').get().n,before.imports+1);
  assert.deepEqual(app.library.list({kind:'question'}).items.map(item=>app.library.item(item.id).answer).sort(),['a','b']);
});

test('Confirmed list and document imports keep the source summary and expected totals',async()=>{
  const list=(await request('/api/library/preview',{url:origin+'/demo/learning/articles',kind:'article',scope:'list'})).value,{value:started}=await request('/api/library/imports',{token:list.token,revision:list.revision});
  const run=await until(()=>app.library.imports().find(row=>row.id===started.id),row=>row.status==='completed');
  assert.equal(run.title,'Tủ sách học tập');assert.equal(run.expected,3);assert.equal(run.items,3);assert.equal(run.method,'list');assert.ok(run.createdAt);
  assert.equal(app.library.list({kind:'article'}).pagination.total,3);
  const pdf=(await request('/api/library/preview',{url:remote+'/manual.pdf',kind:'document'})).value,{value:document}=await request('/api/library/imports',{token:pdf.token,revision:pdf.revision,downloadFiles:true});
  const done=await until(()=>app.library.imports().find(row=>row.id===document.id),row=>row.status==='completed');assert.equal(done.expected,1);assert.equal(done.downloadFiles,true);
  const item=app.library.list({kind:'document'}).items[0];await until(()=>app.library.item(item.id).attachments[0]?.status,status=>status==='done');
});

test('Cancelling a scan aborts the server operation and releases its slot without saving anything',async()=>{
  const before=footprint(),controller=new AbortController(),pending=fetch(origin+'/api/library/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:remote+'/slow-article',kind:'article'}),signal:controller.signal});
  await until(()=>app.library.pending.size,size=>size===1);assert.equal(app.manager.slots.size,1);controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
  await until(()=>app.library.pending.size+app.manager.slots.size,size=>size===0);assert.deepEqual(footprint(),before);
});

test('A legacy imports table gains the token column on restart and keeps its rows',async()=>{
  const isolated=await createApp({dataDirectory:join(directory,'legacy')});const db=isolated.library.db;
  db.exec('DROP INDEX imports_token; ALTER TABLE imports DROP COLUMN token');db.prepare("INSERT INTO imports(id,config,status,created_at) VALUES('old',?,'completed',?)").run(JSON.stringify({kind:'article',url:'https://example.test/a',urls:['https://example.test/a']}),new Date().toISOString());await isolated.close();
  const restarted=await createApp({dataDirectory:join(directory,'legacy')});
  try{assert.ok(restarted.library.db.prepare('PRAGMA table_info(imports)').all().some(column=>column.name==='token'));const row=restarted.library.imports().find(row=>row.id==='old');assert.equal(row.expected,1);assert.equal(row.title,'');}finally{await restarted.close();}
});
