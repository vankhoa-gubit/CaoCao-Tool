import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './jobs.mjs';
import { MessageError } from './messages.mjs';
import { createCapturedPreview, capturedPreview, importCapturedPreview } from './capture.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));

export class ExtensionBridge {
  constructor(directory, library) { Object.assign(this, { directory, library }); this.lastSeenAt = null; }
  async init() {
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, 'extension-bridge.key'), candidate = randomBytes(32).toString('hex');
    try { await writeFile(path, candidate, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    this.secret = (await readFile(path, 'utf8')).trim();
    if (!/^[a-f0-9]{64}$/.test(this.secret)) throw new Error('Invalid local extension bridge key');
    return this;
  }
  async publish(origin) { this.origin = origin; await atomicJson(join(this.directory, 'extension-bridge.json'), { origin, pid: process.pid, protocol: 1 }); }
  async close() {
    try { const path = join(this.directory, 'extension-bridge.json'), value = JSON.parse(await readFile(path, 'utf8')); if (value.pid === process.pid && value.origin === this.origin) await unlink(path); } catch { /* An older app must not remove another app's descriptor. */ }
  }
  async route(request, response, url, bodyJson, json) {
    if (!url.pathname.startsWith('/api/extension/')) return false;
    if (url.pathname === '/api/extension/status' && request.method === 'GET') { json({ lastSeenAt: this.lastSeenAt, protocol: 1 }); return true; }
    if (url.pathname === '/api/extension/setup' && request.method === 'GET') { json({ extensionPath: join(root, 'extension'), lastSeenAt: this.lastSeenAt, canInstall: process.platform === 'win32' }); return true; }
    if (url.pathname === '/api/extension/install' && request.method === 'POST') {
      const input = await bodyJson(request);
      if (input.install !== true || process.platform !== 'win32') throw new MessageError('learning.invalid');
      await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'install-extension.ps1'), '-DataDirectory', this.directory], { windowsHide: true, timeout: 20000 });
      json({ installed: true }); return true;
    }
    const supplied = request.headers.authorization?.replace(/^Bearer /, '') || '';
    if (request.headers.origin || Buffer.byteLength(supplied) !== Buffer.byteLength(this.secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(this.secret))) { json({ error: 'Extension connection required', errorMessage: { code: 'learning.extensionAuth', params: {} } }, 401); return true; }
    this.lastSeenAt = new Date().toISOString();
    const path = url.pathname, method = request.method;
    if (path === '/api/extension/health' && method === 'GET') json({ app: 'cao-cao', protocol: 1, url: this.origin, collections: this.library.collections() });
    else if (path === '/api/extension/collections' && method === 'GET') json({ collections: this.library.collections() });
    else if (path === '/api/extension/collections' && method === 'POST') json(this.library.saveCollection(await bodyJson(request)), 201);
    else if (path === '/api/extension/previews' && method === 'POST') json(createCapturedPreview(this.library, await bodyJson(request)), 201);
    else if (/^\/api\/extension\/previews\/[\w-]+$/.test(path) && method === 'GET') json(capturedPreview(this.library, path.split('/').at(-1)));
    else if (/^\/api\/extension\/previews\/[\w-]+$/.test(path) && method === 'DELETE') { json({ discarded: Boolean(this.library.db.prepare('DELETE FROM browser_captures WHERE id=? AND import_id IS NULL').run(path.split('/').at(-1)).changes) }); }
    else if (path === '/api/extension/imports' && method === 'POST') { const result = importCapturedPreview(this.library, await bodyJson(request)); json(result, result.duplicate ? 200 : 202); }
    else if (/^\/api\/extension\/imports\/[\w-]+$/.test(path) && method === 'GET') {
      const row = this.library.db.prepare('SELECT id,status,items,error FROM imports WHERE id=?').get(path.split('/').at(-1));
      if (!row) throw new MessageError('learning.captureMissing');
      json({ ...row, error: row.error ? JSON.parse(row.error) : null });
    } else throw new MessageError('route.notFound');
    return true;
  }
}
