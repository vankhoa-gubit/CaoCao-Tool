import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createApp,listen,projectRoot} from '../src/server.mjs';
import {demoPdf} from '../src/learning-demo.mjs';
import {retryDelay} from '../src/net.mjs';
import {questionRecord} from '../src/learning-extract.mjs';
import {FileQueue} from '../src/file-queue.mjs';
let app,origin,fixture,remote,directory,collectionId,questionJob,pdfBroken=false,rangeBroken=true,rangeRequests=[],pdfGets=0,coreBroken=true,coreRequests=0;const assetRequests={image:0,font:0,media:0,script:0,xhr:0};
const pdf=Buffer.concat([demoPdf(),Buffer.alloc(12000,' ')]);
async function request(path,body,method){const response=await fetch(origin+path,{method:method||(body===undefined?'GET':'POST'),...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return {response,value:await response.json()};}
async function until(read,predicate,ms=15000){const end=Date.now()+ms;for(;;){const value=await read();if(predicate(value))return value;if(Date.now()>end)throw new Error('Expected learning state not reached');await new Promise(resolve=>setTimeout(resolve,30));}}
async function importPreview(preview,extra={}){const {value}=await request('/api/library/imports',{token:preview.token,...extra});await until(()=>app.library.imports().find(row=>row.id===value.id),row=>['completed','failed','incomplete'].includes(row.status));return value;}
before(async()=>{
  await mkdir(join(projectRoot,'.qa'),{recursive:true});directory=await mkdtemp(join(projectRoot,'.qa','learning-api-'));
  fixture=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/lightweight'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta charset="utf-8"><title>Trang đọc</title><style>@font-face{font-family:fixture;src:url(/reader-font.woff2)}article{font-family:fixture,serif}</style><article><h1>Bài đọc</h1><p id="body">Đang chuẩn bị</p><img src="/reader-image.png"><audio preload="auto" src="/reader-audio.wav"></audio></article><script src="/reader-script.js"></script>');
    }
    const asset={'/reader-image.png':'image','/reader-font.woff2':'font','/reader-audio.wav':'media','/reader-script.js':'script','/reader-content':'xhr'}[url.pathname];
    if(asset){assetRequests[asset]++;if(asset==='script'){res.setHeader('Content-Type','text/javascript');return res.end('fetch("/reader-content").then(r=>r.text()).then(text=>document.querySelector("#body").textContent=text)');}if(asset==='xhr')return res.end('Nội dung được tải qua JavaScript và XHR.');res.setHeader('Content-Type',asset==='image'?'image/png':asset==='font'?'font/woff2':'audio/wav');return res.end(Buffer.alloc(1024));}
    if(url.pathname==='/range.pdf'){
      const offset=Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]||0);rangeRequests.push({range:req.headers.range||null,ifRange:req.headers['if-range']||null});
      res.setHeader('Content-Type','application/pdf');res.setHeader('ETag','"range-v1"');res.setHeader('Accept-Ranges','bytes');
      if(req.method==='HEAD'){res.setHeader('Content-Length',pdf.length);return res.end();}
      if(offset){res.writeHead(206,{'Content-Range':`bytes ${offset}-${pdf.length-1}/${pdf.length}`,'Content-Length':pdf.length-offset});return res.end(pdf.subarray(offset));}
      res.setHeader('Content-Length',pdf.length);if(rangeBroken){rangeBroken=false;res.write(pdf.subarray(0,200));return setTimeout(()=>res.destroy(),30);}return res.end(pdf);
    }
    if(url.pathname==='/guide.pdf'){res.setHeader('Content-Type',pdfBroken?'text/html':'application/pdf');res.setHeader('ETag','"guide-v1"');if(req.method==='HEAD')return res.end();pdfGets++;return res.end(pdfBroken?'<html>Sign in</html>':pdf);}
    if(url.pathname==='/slow.txt'){res.setHeader('Content-Type','text/plain');return setTimeout(()=>res.end('attachment'),500);}
    if(url.pathname==='/retry.txt'){coreRequests++;res.statusCode=coreBroken?404:200;return res.end(coreBroken?'missing':'recovered');}
    if(url.pathname==='/file-records'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[{id:1,file:[remote+'/retry.txt','http://[']}],more:false,total:1}));}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{id:1,question:{text:'Câu hỏi tiếng Việt'},options:['Một','Hai'],correctAnswer:0},{id:2,question:{text:'Câu không có đáp án'},options:[]},{id:3,question:{text:'=1+1'},options:['<script>bad()</script>'],correctAnswer:false}],more:false,total:3}));
  });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));remote=`http://127.0.0.1:${fixture.address().port}`;
  app=await createApp({dataDirectory:directory});origin=await listen(app,0);
});
after(async()=>{await app?.close();await new Promise(resolve=>fixture.close(resolve));});

test('Collection creation, duplicate names and malformed library queries use explicit errors',async()=>{
  const created=await request('/api/library/collections',{name:'Góc đọc của tôi'});assert.equal(created.response.status,201);collectionId=created.value.id;
  assert.equal((await request('/api/library/collections',{name:'Góc đọc của tôi'})).value.errorMessage.code,'learning.collectionExists');
  for(const query of ['page=0','limit=101','kind=unknown'])assert.equal((await request('/api/library?'+query)).response.status,400);
  assert.equal((await request('/api/library/items/999')).response.status,404);
});
test('Saved job → question preview → durable import preserves nested fields, zero/false answers and missing answers',async()=>{
  questionJob=await app.manager.createAndStart({request:{url:remote+'/questions'},sourceId:'learning-tests',extract:{itemsPath:'items',uniqueKey:'id'},pagination:{mode:'page',hasMorePath:'more',totalPath:'total'},limits:{delayMs:0}});await questionJob.promise;
  const {value:preview}=await request(`/api/library/jobs/${questionJob.id}/preview`,{});assert.equal(preview.fields.question,'question.text');assert.equal(preview.sample[0].answer,'0');assert.equal(preview.sample[1].answer,'');assert.equal(preview.sample[2].answer,'false');
  const mapping='/api/library/previews/'+preview.token+'/mapping',remapped=await request(mapping,{fields:{...preview.fields,answer:'id'}});assert.equal(remapped.value.sample[0].answer,'1');await request(mapping,{fields:preview.fields});
  await importPreview(preview,{collectionId});assert.equal(app.library.list({kind:'question'}).pagination.total,3);
  const second=await request(`/api/library/jobs/${questionJob.id}/preview`,{});await importPreview(second.value,{collectionId});assert.equal(app.library.list({kind:'question'}).pagination.total,3);
});
test('Notes, tags, collection moves, accent-insensitive search and card neighbors persist in SQLite',async()=>{
  const item=app.library.list({kind:'question'}).items.find(item=>item.title==='Câu hỏi tiếng Việt');
  const saved=await request('/api/library/items/'+item.id,{notes:'Nhớ xem lại chương hai',tags:['Ôn tập','Ôn tập'],title:'Câu hỏi tiếng Việt',collectionId});assert.deepEqual(saved.value.tags,['Ôn tập']);
  assert.equal((await request('/api/library?search=chuong')).value.pagination.total,1);assert.equal((await request('/api/library?tag='+encodeURIComponent('Ôn tập'))).value.pagination.total,1);
  const neighbors=(await request(`/api/library/items/${item.id}/neighbors?collection=${collectionId}`)).value;assert.equal(neighbors.total,3);assert.ok(neighbors.previous||neighbors.next);
});
test('Question exports stream filtered content, escape HTML and spreadsheet formulas, and omit invented answers',async()=>{
  const base='/api/library/export/';
  const html=await(await fetch(origin+base+'html?kind=question')).text();assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));assert.ok(!html.includes('<script>bad()'));
  const csv=await(await fetch(origin+base+'csv?kind=question')).text();assert.ok(csv.includes("'"+'=1+1'));assert.ok(csv.includes('"0"'));assert.ok(csv.includes('"false"'));
  const markdown=await(await fetch(origin+base+'md?search='+encodeURIComponent('Câu không có'))).text();assert.ok(markdown.includes('Câu không có đáp án'));assert.ok(!markdown.includes('Đáp án / Answer:'));
});
test('Article list imports collect each article body, preserve provenance and reuse preview content',async()=>{
  const {value:preview}=await request('/api/library/preview',{url:origin+'/demo/learning/articles',kind:'article',scope:'list'});assert.equal(preview.count,3);
  await importPreview(preview,{collectionId});const items=app.library.list({kind:'article'}).items;assert.equal(items.length,3);assert.ok(items.every(item=>item.url.includes('/article/')));
  const item=app.library.item(items[0].id);assert.ok(item.body.length>100);assert.ok(item.saved_at);assert.ok(item.body.includes('ghi'));
});

test('Lightweight article previews block image/font/media transfers while keeping JavaScript and XHR content',async()=>{
  const ordinary=await app.sessions.open(remote);try{await ordinary.page.goto(remote+'/lightweight');await ordinary.page.waitForFunction(()=>document.querySelector('#body').textContent.includes('XHR'));await ordinary.page.evaluate(()=>document.fonts.ready);await until(()=>assetRequests.media,count=>count>0);}finally{await ordinary.close();}
  assert.ok(assetRequests.image>0);assert.ok(assetRequests.font>0);const before={...assetRequests};
  const {value:preview}=await request('/api/library/preview',{kind:'article',url:remote+'/lightweight'});assert.ok(preview.sample[0].body.includes('JavaScript và XHR'));assert.equal(assetRequests.image,before.image);assert.equal(assetRequests.font,before.font);assert.equal(assetRequests.media,before.media);assert.ok(assetRequests.script>before.script);assert.ok(assetRequests.xhr>before.xhr);
});
test('Document metadata commits independently; invalid PDF fails visibly and retries without losing content',async()=>{
  pdfBroken=true;const {value:preview}=await request('/api/library/preview',{url:remote+'/guide.pdf',kind:'document'});await importPreview(preview,{downloadFiles:true,collectionId});
  const item=await until(()=>app.library.list({kind:'document'}).items.find(item=>item.url.endsWith('/guide.pdf')),Boolean);await until(()=>app.library.item(item.id).attachments[0],file=>file.status==='failed');assert.equal(app.library.item(item.id).attachments[0].error.code,'learning.fileInvalid');
  pdfBroken=false;await request(`/api/library/items/${item.id}/retry-files`,{});const file=await until(()=>app.library.item(item.id).attachments[0],file=>file.status==='done');
  const response=await fetch(origin+'/api/library/files/'+file.id);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pdf);
  const gets=pdfGets,{value:again}=await request('/api/library/preview',{url:remote+'/guide.pdf',kind:'document'});await importPreview(again,{downloadFiles:true});await new Promise(resolve=>setTimeout(resolve,650));assert.equal(pdfGets,gets);
});
test('Interrupted large file resumes with Range + strong If-Range and yields exact source bytes',async()=>{
  const {value:preview}=await request('/api/library/preview',{url:remote+'/range.pdf',kind:'document'});await importPreview(preview,{downloadFiles:true});
  const item=app.library.list({kind:'document'}).items.find(item=>item.url.endsWith('/range.pdf')),file=await until(()=>app.library.item(item.id).attachments[0],file=>file.status==='done');
  assert.ok(rangeRequests.some(request=>request.range==='bytes=200-'&&request.ifRange==='"range-v1"'));assert.equal(file.bytes,pdf.length);
  const result=Buffer.from(await(await fetch(origin+'/api/library/files/'+file.id)).arrayBuffer());assert.equal(createHash('sha256').update(result).digest('hex'),createHash('sha256').update(pdf).digest('hex'));
});
test('Native PDF export produces an actual PDF and shares admission slots',async()=>{
  const response=await fetch(origin+'/api/library/export/pdf?kind=question');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'application/pdf');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1000);assert.equal(app.manager.slots.size,0);await writeFile(join(directory,'question-export.pdf'),bytes);console.log('Learning PDF evidence: '+join(directory,'question-export.pdf'));
});

test('Shutdown cancels a pending PDF browser operation and returns its admission slot',async()=>{
  const isolated=await createApp({dataDirectory:join(directory,'pdf-shutdown')}),url=await listen(isolated,0);let entered=false;
  isolated.sessions.open=async(_, {signal})=>{entered=true;await new Promise((resolve,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});};
  const response=fetch(url+'/api/library/export/pdf');await until(()=>entered,Boolean);assert.equal(isolated.library.pending.size,1);assert.equal(isolated.manager.slots.size,1);await isolated.close();assert.equal((await response).status,400);assert.equal(isolated.manager.slots.size,0);assert.equal(isolated.library.pending.size,0);
});

test('A question import keeps its shared admission slot after crawling and until library storage finishes',async()=>{
  const isolated=await createApp({dataDirectory:join(directory,'import-admission')}),records=isolated.datasets.records.bind(isolated.datasets);let entered=false,release;
  const gate=new Promise(resolve=>{release=resolve;});isolated.datasets.records=async function*(...args){entered=true;await gate;yield* records(...args);};
  try{
    const token=isolated.library.previewToken({kind:'question',url:remote+'/questions',fields:{question:'question.text',choices:'options',answer:'correctAnswer',id:'id'},jobConfig:{request:{url:remote+'/questions'},extract:{itemsPath:'items',uniqueKey:'id'}}}),run=isolated.library.startImport({token});
    await until(()=>entered,Boolean);assert.equal(isolated.manager.slots.size,1);const second=Symbol('second-import-step'),third=Symbol('third-import-step');isolated.manager.admit(second);assert.throws(()=>isolated.manager.admit(third),error=>error.messageData?.code==='job.capacity');isolated.manager.release(second);
    release();await until(()=>isolated.library.imports().find(row=>row.id===run.id).status,status=>status==='completed');assert.equal(isolated.manager.slots.size,0);assert.equal(isolated.library.list({}).pagination.total,3);
  }finally{release();await isolated.close();}
});
test('Core checkpoints advance before a slow attachment finishes; failed files retry separately',async()=>{
  const job=await app.manager.createAndStart({request:{url:remote+'/questions'},extract:{itemsPath:'items',uniqueKey:'id'},download:{enabled:true,paths:['file']},limits:{delayMs:0}});await job.promise;
  const direct=await app.manager.create({request:{url:remote+'/questions'},extract:{itemsPath:'items',uniqueKey:'id'},download:{enabled:true,paths:['file']}});direct.controller=new AbortController();await direct.hydrateKeys();
  await direct.commit([{id:9,file:remote+'/slow.txt'}],{},null,{engine:'api'});assert.equal(direct.progress.items,1);const checkpoint=JSON.parse(await readFile(join(direct.directory,'checkpoint.json'),'utf8'));assert.equal(checkpoint.progress.items,1);assert.equal(direct.fileQueue.counts().pending,1);await direct.fileQueue.finish(direct.controller.signal);await direct.fileQueue.stop();direct.releaseKeys();
  const retry=await app.manager.createAndStart({request:{url:remote+'/file-records'},extract:{itemsPath:'items',uniqueKey:'id'},pagination:{hasMorePath:'more',totalPath:'total'},download:{enabled:true,paths:['file']},limits:{retries:0,delayMs:0}});await retry.promise;
  assert.equal(retry.status,'completed');assert.equal(retry.progress.items,1);assert.equal(retry.progress.fileErrors,2);assert.equal(retry.progress.files,0);const beforeRequests=retry.progress.requests;
  coreBroken=false;assert.equal((await request('/api/jobs/files/retry',{jobId:retry.id})).response.status,200);await retry.promise;assert.equal(retry.progress.requests,beforeRequests);assert.equal(coreRequests,2);assert.equal(retry.progress.files,1);assert.equal(retry.progress.fileErrors,1);
  const committed=JSON.parse(await readFile(join(retry.directory,'pages','00000001.json'),'utf8'));assert.equal(committed.fileErrors.length,1);assert.equal(committed.items.length,1);assert.equal((await readFile(join(retry.directory,committed.files[0].file),'utf8')),'recovered');
});

test('A queue checkpoint failure stops the worker without silently redownloading the same page',async()=>{
  const path=join(directory,'queue-failure');await mkdir(path);let downloads=0;
  const queue=new FileQueue(path,async()=>{downloads++;return {files:[{url:'https://example.test/file'}],errors:[]};},async()=>{throw new Error('disk full');}),controller=new AbortController();queue.enqueue(1,['https://example.test/file']);
  await assert.rejects(queue.kick(controller.signal),/disk full/);await assert.rejects(queue.finish(controller.signal),/disk full/);assert.equal(downloads,1);assert.equal(queue.counts().pending,1);await queue.stop();
});
test('Checksums reject edited committed content on export/resume while preserving the altered file',async()=>{
  const job=await app.manager.createAndStart({request:{url:remote+'/questions'},extract:{itemsPath:'items',uniqueKey:'id'}});await job.promise;
  const path=join(job.directory,'pages','00000001.json'),page=JSON.parse(await readFile(path,'utf8'));page.items[0].question.text='tampered';await writeFile(path,JSON.stringify(page));const before=await readFile(path);
  await assert.rejects(job.export('json'));job.status='paused';job.state=null;job.start();await job.promise;assert.equal(job.status,'failed');assert.equal(job.errorMessage.code,'checkpoint.pages');assert.deepEqual(await readFile(path),before);
});
test('Retry-After beyond one minute and HTTP dates are never shortened by backoff',()=>{
  assert.equal(retryDelay('120',0,1000,()=>0),120000);assert.equal(retryDelay(new Date(181000).toUTCString(),0,1000,()=>0),180000);assert.equal(questionRecord({question:'Q',answer:false}).answer,'false');
});
test('Restart retains library content, notes, collections and completed files; closing twice is safe',async()=>{
  const total=app.library.list({}).pagination.total;await app.close();await app.close();app=await createApp({dataDirectory:directory});origin=await listen(app,0);assert.equal(app.library.list({}).pagination.total,total);assert.equal(app.library.list({search:'chuong'}).pagination.total,1);assert.equal(app.library.collections().length,1);assert.equal(app.library.list({kind:'document'}).items.filter(item=>item.files).length,2);
  await request('/api/library/collections/'+collectionId,undefined,'DELETE');assert.equal(app.library.list({}).pagination.total,total);assert.equal(app.library.collections().length,0);
});
