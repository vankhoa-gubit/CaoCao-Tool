import { msg, MessageError, errorMessage, fields } from './messages.mjs';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { BrowserSessions, scanWebsite } from './browser.mjs';
import { JobManager, atomicJson } from './jobs.mjs';
import { importInput } from './import.mjs';
import { normalizeConfig, initialState, buildRequest, getAt, arrayPaths, httpUrl } from './config.mjs';
import { fetchJson } from './net.mjs';
import { handleDemo } from './demo.mjs';
import { SourceWorkspace } from './workspace.mjs';
import { DatasetService } from './datasets.mjs';
import { LearningLibrary } from './library.mjs';
import { libraryRoute } from './library-routes.mjs';
import { handleLearningDemo } from './learning-demo.mjs';

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function bodyJson(request) {
  if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) throw new MessageError('request.contentType');
  let bytes = 0; const chunks = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new MessageError('request.tooLarge'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new MessageError('request.json'); }
}

export async function createApp({ dataDirectory = join(projectRoot, 'data'), sessions: suppliedSessions, scanOptions, workspaceOptions, analyze } = {}) {
  const sessions = suppliedSessions || new BrowserSessions(join(dataDirectory, 'sessions'));
  const manager = await new JobManager(join(dataDirectory, 'jobs'), sessions).init();
  const scans = new Map();
  const workspace = await new SourceWorkspace(dataDirectory, manager, analyze || ((url, signal) => scanWebsite(url, sessions, () => {}, signal, scanOptions)), workspaceOptions).init();
  const datasets = new DatasetService(manager);
  const library = await new LearningLibrary(join(dataDirectory, 'library'), manager, datasets, sessions, { scanOptions }).init();
  const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/workspace.js': ['workspace.js', 'text/javascript; charset=utf-8'], '/workspace-i18n.js': ['workspace-i18n.js', 'text/javascript; charset=utf-8'], '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'], '/messages.js': ['messages.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  Object.assign(staticFiles, { '/learning.js': ['learning.js','text/javascript; charset=utf-8'], '/learning-i18n.js': ['learning-i18n.js','text/javascript; charset=utf-8'], '/learning.css': ['learning.css','text/css; charset=utf-8'] });
  const server = http.createServer(async (request, response) => {
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const port = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host)) { json(fields(msg('request.host'), 'error'), 403); return; }
      const origin = `http://127.0.0.1:${port}`;
      if (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') { json(fields(msg('request.origin'), 'error'), 403); return; }
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(request.url, origin), pathname = url.pathname;
      if (await libraryRoute(request, response, url, library, bodyJson, json)) return;
      if (pathname === '/api/jobs/files/retry' && request.method === 'POST') { const input = await bodyJson(request); json(manager.get(input.jobId).retryFiles()); return; }
      if (request.method === 'GET' && staticFiles[pathname]) {
        const [file, mime] = staticFiles[pathname];
        response.writeHead(200, { 'Content-Type': mime, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'Cache-Control': 'no-cache' });
        response.end(await readFile(join(projectRoot, 'public', file))); return;
      }
      const demo = pathname.startsWith('/demo/') && (handleLearningDemo(url, origin) || handleDemo(url, origin));
      if (demo && ['GET','HEAD'].includes(request.method)) {
        if (demo.json) json(demo.json, demo.status || 200);
        else { response.writeHead(demo.status || 200, { 'Content-Type': demo.html ? 'text/html; charset=utf-8' : demo.mime, ...(demo.buffer ? {'Content-Length':demo.buffer.length,'ETag':'"learning-guide-v1"'} : {}) }); response.end(request.method === 'HEAD' ? undefined : demo.buffer || demo.html || demo.text); }
        return;
      }
      if (request.method === 'GET' && pathname === '/api/health') { json({ ok: true, outputPath: dataDirectory, node: process.version, version: '1.4.0', features: ['deferred-batches', 'archive-import', 'offset-origin', 'prefix-recovery', 'job-admission', 'paged-history', 'lazy-restore', 'message-codes', 'source-profiles', 'queue', 'scheduled-runs', 'data-explorer', 'run-comparison', 'quality-reports','learning-library','offline-reader','question-cards','sqlite-key-index','file-queue','page-checksums'] }); return; }
      if (request.method === 'GET' && pathname === '/api/jobs') {
        json(url.search ? { ...manager.list(Object.fromEntries(url.searchParams)), activity: { running: [...manager.jobs.values()].filter(job => job.promise).length, pending: manager.slots.size } } : { jobs: manager.list() }); return;
      }
      if (pathname === '/api/sources' && request.method === 'GET') { json({ sources: workspace.snapshot().sources }); return; }
      if (pathname === '/api/sources' && request.method === 'POST') { json(await workspace.saveSource(await bodyJson(request)), 201); return; }
      const sourceMatch = pathname.match(/^\/api\/sources\/([\w-]+)(?:\/(runs|run))?$/);
      if (sourceMatch) {
        const source = workspace.source(sourceMatch[1]);
        if (request.method === 'GET' && sourceMatch[2] === 'runs') { json(manager.list({ ...Object.fromEntries(url.searchParams), sourceId: source.id })); return; }
        if (request.method === 'GET' && !sourceMatch[2]) { json(source); return; }
        if (request.method === 'POST' && sourceMatch[2] === 'run') { await bodyJson(request); json({ queue: await workspace.enqueue({ sourceId: source.id }) }, 202); return; }
        if (request.method === 'POST' && !sourceMatch[2]) { json(await workspace.saveSource(await bodyJson(request), source.id)); return; }
        if (request.method === 'DELETE' && !sourceMatch[2]) { json(await workspace.deleteSource(source.id)); return; }
      }
      if (pathname === '/api/workspace' && request.method === 'GET') { json(workspace.snapshot(Object.fromEntries(url.searchParams))); return; }
      if (pathname === '/api/queue' && request.method === 'POST') { json({ queue: await workspace.enqueue(await bodyJson(request)) }, 202); return; }
      const queueMatch = pathname.match(/^\/api\/queue\/([\w-]+)\/(retry|cancel)$/);
      if (queueMatch && request.method === 'POST') { await bodyJson(request); json(await workspace[queueMatch[2]](queueMatch[1])); return; }
      const dataMatch = pathname.match(/^\/api\/jobs\/([a-z0-9-]+)\/(records(?:\/(\d+|export\/(json|jsonl|csv)))?|quality|compare)$/);
      if (dataMatch && request.method === 'GET') {
        const id = dataMatch[1], query = Object.fromEntries(url.searchParams);
        if (dataMatch[4]) {
          // Validate query and job before sending headers; stream the saved-page snapshot.
          const generator = datasets.export(id, dataMatch[4], query), first = await generator.next();
          response.writeHead(200, { 'Content-Type': dataMatch[4] === 'csv' ? 'text/csv; charset=utf-8' : dataMatch[4] === 'json' ? 'application/json; charset=utf-8' : 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="cao-cao-${id}-filtered.${dataMatch[4]}"`, 'Cache-Control': 'no-store' });
          async function* output() { try { if (!first.done) yield first.value; yield* generator; } finally { await generator.return(); } }
          await pipeline(Readable.from(output()), response); return;
        }
        if (dataMatch[3]) { json(await datasets.record(id, dataMatch[3])); return; }
        if (dataMatch[2] === 'quality') { json(await datasets.quality(id)); return; }
        if (dataMatch[2] === 'compare') { json(await datasets.compare(id, query.base, query)); return; }
        json(await datasets.browse(id, query)); return;
      }
      const scanMatch = pathname.match(/^\/api\/scans\/([\w-]+)$/);
      if (request.method === 'GET' && scanMatch) { const scan = scans.get(scanMatch[1]); if (!scan) { json(fields(msg('scan.notFoundRescan'), 'error'), 404); return; } const { controller, promise, ...publicScan } = scan; json(publicScan); return; }
      const cancelMatch = pathname.match(/^\/api\/scans\/([\w-]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        await bodyJson(request); const scan = scans.get(cancelMatch[1]);
        if (!scan) throw new MessageError('scan.notFound');
        scan.controller.abort(new MessageError('scan.cancelled')); json({ cancelled: true }); return;
      }
      const jobMatch = pathname.match(/^\/api\/jobs\/([a-z0-9-]+)(?:\/(pause|resume|export\/(json|jsonl|csv)))?$/);
      if (jobMatch) {
        const job = manager.get(jobMatch[1]);
        if (request.method === 'GET' && !jobMatch[2]) { json(job.summary()); return; }
        if (request.method === 'GET' && jobMatch[3]) {
          const format = jobMatch[3], target = await job.export(format);
          response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8', 'Content-Disposition': `attachment; filename="cao-cao-${job.id}.${format}"`, 'Cache-Control': 'no-store' });
          await pipeline(createReadStream(target), response); return;
        }
        if (request.method === 'POST' && jobMatch[2] === 'pause') { await bodyJson(request); json(await job.pause()); return; }
        if (request.method === 'POST' && jobMatch[2] === 'resume') { await bodyJson(request); json(job.start()); return; }
      }
      if (request.method === 'POST' && pathname === '/api/import') { const body = await bodyJson(request); json(importInput(body.source, body.selectedIndex)); return; }
      if (request.method === 'POST' && pathname === '/api/preview') {
        const input = await bodyJson(request), config = normalizeConfig(input);
        const raw = await fetchJson(buildRequest(config, initialState(config)), config.limits);
        const items = getAt(raw, config.extract.itemsPath);
        json({ paths: arrayPaths(raw), count: Array.isArray(items) ? items.length : null, sample: Array.isArray(items) ? items.slice(0, 5) : [], responseText: JSON.stringify(raw, null, 2).slice(0, 30000) }); return;
      }
      if (request.method === 'POST' && pathname === '/api/scans') {
        const input = await bodyJson(request); httpUrl(input.url);
        if ([...scans.values()].some(scan => scan.status === 'running')) throw new MessageError('scan.running');
        const id = randomUUID(), controller = new AbortController();
        const scan = { id, url: input.url, status: 'running', progress: { ...fields(msg('scan.preparing'), 'stage'), requests: 0, records: 0 }, startedAt: new Date().toISOString(), controller };
        scans.set(id, scan);
        const timer = setTimeout(() => controller.abort(new MessageError('scan.timeout')), 90000);
        scan.promise = scanWebsite(input.url, sessions, progress => { scan.progress = progress; }, controller.signal, scanOptions)
          .then(async report => { scan.report = report; scan.status = 'completed'; Object.assign(scan.progress, fields(msg('scan.complete'), 'stage')); await mkdir(join(dataDirectory, 'scans'), { recursive: true }); await atomicJson(join(dataDirectory, 'scans', `${id}.json`), report); })
          .catch(error => { scan.status = 'failed'; Object.assign(scan, fields(errorMessage(controller.signal.aborted ? controller.signal.reason : error), 'error')); })
          .finally(() => clearTimeout(timer));
        json({ id, status: scan.status }, 202); return;
      }
      if (request.method === 'POST' && pathname === '/api/jobs') {
        const input = await bodyJson(request);
        let config = input.config;
        if (input.scanId) {
          const scan = scans.get(input.scanId);
          if (!scan?.report || scan.status !== 'completed') throw new MessageError('scan.required');
          if (['blocked', 'login', 'unknown'].includes(scan.report.capability)) throw new MessageError(scan.report.messageData);
          const candidate = scan.report.candidates.find(item => item.id === String(input.candidateId ?? '0'));
          const mode = input.mode === 'api' ? 'api' : input.mode === 'browser' ? 'browser' : scan.report.recommendedMode;
          if (mode === 'api') {
            config = candidate?.apiConfig;
            if (!config) throw new MessageError('scan.apiIncomplete');
            config = { ...config, kind: 'api' };
          } else config = { ...scan.report.browserConfig, ...(candidate ? { source: candidate.source, extract: { itemsPath: candidate.itemsPath, uniqueKey: candidate.source.uniqueKey }, download: { ...scan.report.browserConfig.download, paths: candidate.filePaths } } : { source: null, extract: { itemsPath: '$', uniqueKey: '_key' }, download: { ...scan.report.browserConfig.download, paths: ['images'] } }) };
          config = { ...config, limits: { ...config.limits, ...input.limits }, download: { ...config.download, enabled: input.downloadFiles === true } };
        }
        const job = await manager.createAndStart(config); json(job.summary(), 201); return;
      }
      if (request.method === 'POST' && pathname === '/api/browser/login') { const input = await bodyJson(request); json({ id: await sessions.login(input.url) }); return; }
      if (request.method === 'POST' && pathname === '/api/browser/save') { const input = await bodyJson(request); await sessions.saveLogin(input.id); json({ saved: true }); return; }
      json(fields(msg('route.notFound'), 'error'), 404);
    } catch (error) {
      if (!response.headersSent) json(fields(errorMessage(error), 'error'), ['source.notFound', 'job.notFound', 'queue.notFound', 'data.recordMissing','learning.itemMissing','learning.collectionMissing','learning.fileMissing'].includes(error.messageData?.code) ? 404 : ['job.capacity', 'source.inUse', 'queue.retry', 'queue.cancel','learning.importBusy'].includes(error.messageData?.code) ? 409 : 400);
      else response.destroy();
    }
  });
  server.once('listening', () => { workspace.start(); library.start(); });
  const close = async () => { for (const scan of scans.values()) scan.controller.abort(); await library.close(); await workspace.close(); await Promise.allSettled([...scans.values()].map(scan => scan.promise)); await manager.close(); await new Promise(resolve => server.close(resolve)); };
  return { server, manager, sessions, scans, workspace, datasets, library, close };
}

export async function listen(app, preferredPort = 4317) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(preferredPort ? preferredPort + attempt : 0, '127.0.0.1', () => { app.server.removeListener('error', reject); resolve(); }); });
      return `http://127.0.0.1:${app.server.address().port}`;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new MessageError('port.busy');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let app;
  try {
  const index = process.argv.indexOf('--port'), port = index >= 0 ? Number(process.argv[index + 1]) : Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65525) throw new MessageError('port.invalid');
  app = await createApp(); const url = await listen(app, port);
  console.log(`Cào Cào đang chạy tại ${url}\nDữ liệu lưu tại ${join(projectRoot, 'data')}\nNhấn Ctrl+C để dừng và lưu các tác vụ.`);
  if (process.argv.includes('--open')) {
    const startUrl = url + '/#library';
    const child = process.platform === 'win32' ? spawn('cmd.exe', ['/c', 'start', '', startUrl], { windowsHide: true, detached: true, stdio: 'ignore' }) : spawn('xdg-open', [startUrl], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  }
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  } catch (error) { console.error('Chưa mở được Cào Cào: ' + error.message);await app?.close();process.exitCode = 1; }
}
