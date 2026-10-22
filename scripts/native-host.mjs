import { readFile, open, unlink, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = resolve(process.env.CAOCAO_DATA_DIR || join(root, 'data'));
const manifest = JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8'));
export const extensionId = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, value => String.fromCharCode(97 + parseInt(value, 16)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const origin = process.argv[2];
if (origin !== `chrome-extension://${extensionId}/`) { process.stderr.write('Unrecognized extension origin\n'); process.exit(1); }

async function descriptor() {
  const value = JSON.parse(await readFile(join(directory, 'extension-bridge.json'), 'utf8'));
  const url = new URL(value.origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.username || url.password || value.protocol !== 1) throw new Error('bridgeUnavailable');
  const secret = (await readFile(join(directory, 'extension-bridge.key'), 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('bridgeUnavailable');
  return { url: url.origin, secret };
}
async function probe() {
  const target = await descriptor();
  const response = await fetch(target.url + '/api/extension/health', { headers: { Authorization: `Bearer ${target.secret}` }, signal: AbortSignal.timeout(1500) });
  const value = await response.json();
  if (!response.ok || value.app !== 'cao-cao' || value.protocol !== 1) throw new Error('bridgeUnavailable');
  return target;
}
async function existingApp() {
  if (process.env.CAOCAO_BRIDGE_PORT === '0') return false;
  const preferred = Number(process.env.CAOCAO_BRIDGE_PORT || 4317);
  const ports = [...new Set([preferred, ...Array.from({ length: 10 }, (_, index) => 4317 + index)])].filter(port => Number.isInteger(port) && port > 0 && port < 65536);
  const matches = await Promise.all(ports.map(async port => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(500) }), health = await response.json();
      if (!response.ok || health.ok !== true || typeof health.version !== 'string' || typeof health.outputPath !== 'string') return false;
      const path = resolve(health.outputPath);
      return process.platform === 'win32' ? path.toLowerCase() === directory.toLowerCase() : path === directory;
    } catch { return false; }
  }));
  return matches.some(Boolean);
}
async function connection() {
  try { return await probe(); } catch { /* Start the local application on first use. */ }
  if (await existingApp()) {
    for (let attempt = 0; attempt < 3; attempt++) { await delay(100); try { return await probe(); } catch {} }
    throw new Error('learning.extensionRestart');
  }
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, 'extension-launch.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
    await lock.writeFile(String(Date.now()));
    const child = spawn(process.execPath, [join(root, 'src', 'server.mjs'), '--port', process.env.CAOCAO_BRIDGE_PORT || '4317'], { cwd: root, env: { ...process.env, CAOCAO_DATA_DIR: directory }, windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {}); child.unref();
  } catch (error) {
    if (error.code !== 'EEXIST') throw new Error('bridgeUnavailable');
    try { if (Date.now() - Number(await readFile(lockPath, 'utf8')) > 30000) { await unlink(lockPath); return connection(); } } catch { /* Another host may have removed its lock. */ }
  }
  try {
    for (let attempt = 0; attempt < 60; attempt++) { try { return await probe(); } catch { await delay(200); } }
    throw new Error('bridgeUnavailable');
  } finally { if (lock) { await lock.close(); await unlink(lockPath).catch(() => {}); } }
}
const commands = {
  health: () => ['GET', '/health'],
  collections: () => ['GET', '/collections'],
  createCollection: payload => ['POST', '/collections', { name: payload.name }],
  preview: payload => ['POST', '/previews', payload],
  getPreview: payload => ['GET', '/previews/' + identifier(payload.id)],
  discard: payload => ['DELETE', '/previews/' + identifier(payload.id)],
  import: payload => ['POST', '/imports', { id: payload.id, collectionId: payload.collectionId }],
  importStatus: payload => ['GET', '/imports/' + identifier(payload.id)]
};
function identifier(value) { if (typeof value !== 'string' || !/^[\w-]{1,80}$/.test(value)) throw new Error('invalidCommand'); return value; }
async function dispatch(message) {
  if (!message || !Object.hasOwn(commands, message.command)) throw new Error('invalidCommand');
  const [method, path, body] = commands[message.command](message.payload || {}), target = await connection();
  const response = await fetch(target.url + '/api/extension' + path, { method, headers: { Authorization: `Bearer ${target.secret}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.errorMessage?.code || 'bridgeUnavailable');
  return result;
}
function send(value) {
  let bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 900 * 1024) bytes = Buffer.from(JSON.stringify({ id: value.id, ok: false, error: 'learning.captureLimit' }));
  const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length);
  process.stdout.write(Buffer.concat([length, bytes]));
}
let pending = Buffer.alloc(0), queue = Promise.resolve(), ending = false;
process.stdin.on('data', chunk => {
  pending = Buffer.concat([pending, chunk]);
  while (pending.length >= 4) {
    const length = pending.readUInt32LE();
    if (length > 8 * 1024 * 1024 || length < 2) { process.stderr.write('Invalid native message length\n'); process.exit(1); }
    if (pending.length < length + 4) break;
    const frame = pending.subarray(4, length + 4); pending = pending.subarray(length + 4);
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(frame.toString('utf8')); const result = await dispatch(message); send({ id: message.id, ok: true, result }); }
      catch (error) { send({ id: message?.id ?? null, ok: false, error: /^(learning\.|invalidCommand|bridgeUnavailable)/.test(error.message) ? error.message : 'bridgeUnavailable' }); }
    });
  }
});
process.stdin.on('end', () => { ending = true; queue.finally(() => { if (pending.length) process.exitCode = 1; }); });
process.stdout.on('error', () => { if (!ending) process.exitCode = 1; });
