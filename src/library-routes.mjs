import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MessageError } from './messages.mjs';
import { learningExport, learningPdf } from './learning-exports.mjs';

export async function libraryRoute(request,response,url,library,bodyJson,json) {
  const path=url.pathname,method=request.method,query=Object.fromEntries(url.searchParams);
  if(!path.startsWith('/api/library'))return false;
  if(path==='/api/library'&&method==='GET'){json(library.list(query));return true;}
  if(path==='/api/library/collections'){
    if(method==='GET')json({collections:library.collections()});
    else if(method==='POST')json(library.saveCollection(await bodyJson(request)),201);
    else throw new MessageError('route.notFound');return true;
  }
  let match=path.match(/^\/api\/library\/collections\/(\d+)$/);
  if(match){if(method==='POST')json(library.saveCollection(await bodyJson(request),match[1]));else if(method==='DELETE')json(library.deleteCollection(match[1]));else throw new MessageError('route.notFound');return true;}
  if(path==='/api/library/preview'&&method==='POST'){
    const input=await bodyJson(request),owner=Symbol('learning-preview');library.manager.admit(owner);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000),abort=()=>controller.abort();response.once('close',abort);library.controllers.add(controller);
    const operation=library.preview(input,controller.signal);library.pending.add(operation);
    try{json(await operation);}finally{library.pending.delete(operation);library.controllers.delete(controller);clearTimeout(timer);response.off('close',abort);library.manager.release(owner);}return true;
  }
  match=path.match(/^\/api\/library\/jobs\/([\w-]+)\/preview$/);
  if(match&&method==='POST'){json(await library.jobPreview(match[1],await bodyJson(request)));return true;}
  match=path.match(/^\/api\/library\/previews\/([\w-]+)\/mapping$/);
  if(match&&method==='POST'){json(library.remapPreview(match[1],await bodyJson(request)));return true;}
  if(path==='/api/library/imports'&&method==='POST'){json(library.startImport(await bodyJson(request)),202);return true;}
  match=path.match(/^\/api\/library\/imports\/([\w-]+)\/(pause|resume)$/);
  if(match&&method==='POST'){await bodyJson(request);json(await library.importAction(match[1],match[2]));return true;}
  match=path.match(/^\/api\/library\/items\/(\d+)(?:\/(neighbors|retry-files|export\/(html|md|csv|pdf)))?$/);
  if(match){
    if(match[3]&&method==='GET'){await sendExport([library.item(match[1])],match[3],library,request,response);return true;}
    if(match[2]==='neighbors'&&method==='GET'){json(library.neighbors(match[1],query));return true;}
    if(match[2]==='retry-files'&&method==='POST'){await bodyJson(request);json(library.retryFiles(match[1]));return true;}
    if(!match[2]){if(method==='GET')json(library.item(match[1]));else if(method==='POST')json(library.updateItem(match[1],await bodyJson(request)));else if(method==='DELETE')json(library.deleteItem(match[1]));else throw new MessageError('route.notFound');return true;}
  }
  match=path.match(/^\/api\/library\/files\/(\d+)$/);
  if(match&&method==='GET'){
    const file=library.file(match[1]),pdf=/application\/pdf/i.test(file.mime)&&file.path.endsWith('.pdf');
    response.writeHead(200,{'Content-Type':pdf?'application/pdf':'application/octet-stream','Content-Disposition':`${pdf?'inline':'attachment'}; filename="cao-cao-${file.id}${file.path.match(/\.[a-z0-9]{1,8}$/)?.[0]||'.bin'}"`,'Content-Security-Policy':"sandbox; default-src 'none'",'Cache-Control':'no-store'});await pipeline(createReadStream(file.target),response);return true;
  }
  match=path.match(/^\/api\/library\/export\/(html|md|csv|pdf)$/);
  if(match&&method==='GET'){await sendExport(library.exportRows(query),match[1],library,request,response);return true;}
  throw new MessageError('route.notFound');
}
async function sendExport(rows,format,library,request,response){
  if(format==='pdf'){
    const owner=Symbol('learning-pdf'),controller=new AbortController();library.manager.admit(owner);const abort=()=>controller.abort();response.once('close',abort);
    library.controllers.add(controller);
    const operation=learningPdf(rows,library.sessions,controller.signal);library.pending.add(operation);
    try{const pdf=await operation;response.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="cao-cao.pdf"','Cache-Control':'no-store'});response.end(pdf);}finally{library.pending.delete(operation);library.controllers.delete(controller);response.off('close',abort);library.manager.release(owner);}return;
  }
  const generator=learningExport(rows,format),first=await generator.next();
  response.writeHead(200,{'Content-Type':format==='html'?'text/html; charset=utf-8':format==='csv'?'text/csv; charset=utf-8':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="cao-cao.${format}"`,'Cache-Control':'no-store','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'"});
  async function* output(){try{if(!first.done)yield first.value;yield* generator;}finally{await generator.return();}}
  await pipeline(Readable.from(output()),response);
}
