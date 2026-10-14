import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobManager } from '../src/jobs.mjs';
import { createApp, projectRoot } from '../src/server.mjs';

async function crashed(mode, directory, url) {
  const child = fork(fileURLToPath(new URL('./helpers/crash-worker.mjs', import.meta.url)), [mode, directory, url], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  let diagnostic = '';child.stderr.on('data', chunk => { diagnostic += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    const stage = await Promise.race([once(child, 'message').then(([value]) => value), once(child, 'exit').then(() => { throw new Error('Recovery child exited too early: ' + diagnostic); })]);
    const exit = once(child, 'exit');child.kill('SIGKILL');await exit;return stage;
  } finally { clearTimeout(timer);if(child.exitCode === null && child.signalCode === null)child.kill('SIGKILL'); }
}
async function fixture(total, run) {
  const requested = [], server = http.createServer((req, res) => {
    const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page') || 1), offset = (page - 1) * 10;
    requested.push(page);
    const items = Array.from({ length: Math.max(0, Math.min(10, total - offset)) }, (_, i) => ({ id: offset + i, question: 'Question ' + (offset + i), answer: String(offset + i) }));
    if (offset > 0 && offset < total) items.unshift({ id: offset - 1, question: 'Question ' + (offset - 1), answer: String(offset - 1) });
    res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({ items, more: offset + 10 < total, total }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await mkdir(join(projectRoot, '.qa'), { recursive: true });const directory = await mkdtemp(join(projectRoot, '.qa', 'crash-recovery-'));
  try { await run(directory, `http://127.0.0.1:${server.address().port}/questions`, requested); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
test('Abrupt process kill between a durable page and its checkpoint recovers the cursor and every unique ID', { timeout: 30000 }, async () => {
  await fixture(70, async (directory, url, requested) => {
    const stage = await crashed('pages', directory, url), path = join(directory, 'jobs', stage.id, 'pages', '00000002.json'), before = await readFile(path);
    const manager = await new JobManager(join(directory, 'jobs'), { async closeAll() {} }).init();
    try {
      const job = manager.get(stage.id);assert.equal(job.status, 'paused');assert.equal(job.restoreSource, 'pages');assert.equal(job.progress.items, 20);job.start();await job.promise;assert.equal(job.status, 'completed');
      let expected = 0;for await(const record of job.records())assert.equal(record.id, expected++);assert.equal(expected,70);assert.deepEqual(requested,[1,2,3,4,5,6,7]);assert.deepEqual(await readFile(path),before);assert.equal(job.keys.size,0);
    } finally { await manager.close(); }
  });
});
test('Abrupt process kill after a library transaction retains its items and resumes from the saved import cursor', { timeout: 30000 }, async () => {
  await fixture(150, async (directory, url, requested) => {
    await crashed('library', directory, url);const app = await createApp({ dataDirectory: directory });
    try {
      const row = app.library.imports()[0];assert.equal(row.status,'paused');assert.equal(row.cursor,100);assert.equal(app.library.list({}).pagination.total,100);const beforeRequests=requested.length;
      await app.library.importAction(row.id,'resume');const deadline=Date.now()+10000;
      while(app.library.imports()[0].status!=='completed'){assert.ok(Date.now()<deadline,'Library import did not recover');await new Promise(resolve=>setTimeout(resolve,20));}
      assert.equal(app.library.list({}).pagination.total,150);assert.equal(app.library.imports()[0].cursor,150);assert.equal(requested.length,beforeRequests);
      const all=app.library.db.prepare('SELECT body,answer FROM items ORDER BY id').all();for(let i=0;i<all.length;i++){assert.equal(all[i].body,'Question '+i);assert.equal(all[i].answer,String(i));}
    } finally { await app.close(); }
  });
});
