import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
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

export const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function bodyJson(request) {
  if (!/^application\/json\b/i.test(request.headers['content-type'] || '')) throw new Error('Request cần Content-Type application/json.');
  let bytes = 0; const chunks = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new Error('Nội dung gửi lên vượt 32 MB.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Nội dung JSON gửi lên không hợp lệ.'); }
}

export async function createApp({ dataDirectory = join(projectRoot, 'data'), sessions: suppliedSessions, scanOptions } = {}) {
  const sessions = suppliedSessions || new BrowserSessions(join(dataDirectory, 'sessions'));
  const manager = await new JobManager(join(dataDirectory, 'jobs'), sessions).init();
  const scans = new Map();
  const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  const server = http.createServer(async (request, response) => {
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
    try {
      const port = server.address()?.port;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(request.headers.host)) { json({ error: 'Host không được phép truy cập tool cục bộ.' }, 403); return; }
      const origin = `http://127.0.0.1:${port}`;
      if (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') { json({ error: 'Yêu cầu từ trang khác bị từ chối.' }, 403); return; }
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(request.url, origin), pathname = url.pathname;
      if (request.method === 'GET' && staticFiles[pathname]) {
        const [file, mime] = staticFiles[pathname];
        response.writeHead(200, { 'Content-Type': mime, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'", 'Cache-Control': 'no-cache' });
        response.end(await readFile(join(projectRoot, 'public', file))); return;
      }
      const demo = pathname.startsWith('/demo/') && handleDemo(url, origin);
      if (demo && request.method === 'GET') {
        if (demo.json) json(demo.json, demo.status || 200);
        else { response.writeHead(demo.status || 200, { 'Content-Type': demo.html ? 'text/html; charset=utf-8' : demo.mime }); response.end(demo.html || demo.text); }
        return;
      }
      if (request.method === 'GET' && pathname === '/api/health') { json({ ok: true, outputPath: dataDirectory, node: process.version, version: '1.1.2', features: ['deferred-batches', 'archive-import', 'offset-origin', 'prefix-recovery'] }); return; }
      if (request.method === 'GET' && pathname === '/api/jobs') { json({ jobs: manager.list() }); return; }
      const scanMatch = pathname.match(/^\/api\/scans\/([\w-]+)$/);
      if (request.method === 'GET' && scanMatch) { const scan = scans.get(scanMatch[1]); if (!scan) { json({ error: 'Không tìm thấy lượt quét. Quét lại URL.' }, 404); return; } const { controller, promise, ...publicScan } = scan; json(publicScan); return; }
      const cancelMatch = pathname.match(/^\/api\/scans\/([\w-]+)\/cancel$/);
      if (request.method === 'POST' && cancelMatch) {
        await bodyJson(request); const scan = scans.get(cancelMatch[1]);
        if (!scan) throw new Error('Không tìm thấy lượt quét.');
        scan.controller.abort(new Error('Lượt quét đã được hủy.')); json({ cancelled: true }); return;
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
        if ([...scans.values()].some(scan => scan.status === 'running')) throw new Error('Một URL đang được quét. Đợi lượt quét kết thúc.');
        const id = randomUUID(), controller = new AbortController();
        const scan = { id, url: input.url, status: 'running', progress: { stage: 'Đang chuẩn bị', requests: 0, records: 0 }, startedAt: new Date().toISOString(), controller };
        scans.set(id, scan);
        const timer = setTimeout(() => controller.abort(new Error('Lượt quét đã hết thời gian. Trang có thể tải quá chậm; hãy thử lại.')), 90000);
        scan.promise = scanWebsite(input.url, sessions, progress => { scan.progress = progress; }, controller.signal, scanOptions)
          .then(async report => { scan.report = report; scan.status = 'completed'; scan.progress.stage = 'Đã nhận diện'; await mkdir(join(dataDirectory, 'scans'), { recursive: true }); await atomicJson(join(dataDirectory, 'scans', `${id}.json`), report); })
          .catch(error => { scan.status = 'failed'; scan.error = controller.signal.aborted ? controller.signal.reason.message : error.message; })
          .finally(() => clearTimeout(timer));
        json({ id, status: scan.status }, 202); return;
      }
      if (request.method === 'POST' && pathname === '/api/jobs') {
        const input = await bodyJson(request);
        if (manager.list().filter(job => job.status === 'running').length >= 2) throw new Error('Đã có 2 tác vụ đang chạy. Tạm dừng một tác vụ hoặc chờ hoàn tất.');
        let config = input.config;
        if (input.scanId) {
          const scan = scans.get(input.scanId);
          if (!scan?.report || scan.status !== 'completed') throw new Error('Quét URL thành công trước khi bắt đầu.');
          if (['blocked', 'login', 'unknown'].includes(scan.report.capability)) throw new Error(scan.report.message);
          const candidate = scan.report.candidates.find(item => item.id === String(input.candidateId ?? '0'));
          const mode = input.mode === 'api' ? 'api' : input.mode === 'browser' ? 'browser' : scan.report.recommendedMode;
          if (mode === 'api') {
            config = candidate?.apiConfig;
            if (!config) throw new Error('Nguồn này chưa nhận diện đủ tham số API. Chọn cách tải qua trình duyệt.');
            config = { ...config, kind: 'api' };
          } else config = { ...scan.report.browserConfig, ...(candidate ? { source: candidate.source, extract: { itemsPath: candidate.itemsPath, uniqueKey: candidate.source.uniqueKey }, download: { ...scan.report.browserConfig.download, paths: candidate.filePaths } } : { source: null, extract: { itemsPath: '$', uniqueKey: '_key' }, download: { ...scan.report.browserConfig.download, paths: ['images'] } }) };
          config = { ...config, limits: { ...config.limits, ...input.limits }, download: { ...config.download, enabled: input.downloadFiles === true } };
        }
        const job = await manager.create(config); json(job.start(), 201); return;
      }
      if (request.method === 'POST' && pathname === '/api/browser/login') { const input = await bodyJson(request); json({ id: await sessions.login(input.url) }); return; }
      if (request.method === 'POST' && pathname === '/api/browser/save') { const input = await bodyJson(request); await sessions.saveLogin(input.id); json({ saved: true }); return; }
      json({ error: 'Không tìm thấy địa chỉ.' }, 404);
    } catch (error) {
      if (!response.headersSent) json({ error: error.message }, 400);
      else response.destroy();
    }
  });
  const close = async () => { for (const scan of scans.values()) scan.controller.abort(); await Promise.allSettled([...scans.values()].map(scan => scan.promise)); await manager.close(); await new Promise(resolve => server.close(resolve)); };
  return { server, manager, sessions, scans, close };
}

export async function listen(app, preferredPort = 4317) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(preferredPort ? preferredPort + attempt : 0, '127.0.0.1', () => { app.server.removeListener('error', reject); resolve(); }); });
      return `http://127.0.0.1:${app.server.address().port}`;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw new Error('Các cổng 4317–4326 đang bận. Chạy node src/server.mjs --port 4500.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = process.argv.indexOf('--port'), port = index >= 0 ? Number(process.argv[index + 1]) : Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65525) throw new Error('Cổng không hợp lệ.');
  const app = await createApp(); const url = await listen(app, port);
  console.log(`Cào Cào đang chạy tại ${url}\nDữ liệu lưu tại ${join(projectRoot, 'data')}\nNhấn Ctrl+C để dừng và lưu các tác vụ.`);
  if (process.argv.includes('--open')) {
    const child = process.platform === 'win32' ? spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }) : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  }
  let closing = false;
  const shutdown = async () => { if (closing) return; closing = true; await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
