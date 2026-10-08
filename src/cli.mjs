import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserSessions, scanWebsite } from './browser.mjs';
import { JobManager } from './jobs.mjs';
import { projectRoot } from './server.mjs';

const arg = name => { const at = process.argv.indexOf(name); return at >= 0 ? process.argv[at + 1] : undefined; };
if (!arg('--url') && !arg('--config') && !arg('--resume')) {
  console.log('node src/cli.mjs --url https://example.com/list\nnode src/cli.mjs --config examples/page.json\nnode src/cli.mjs --resume <job-id>');
  process.exit(0);
}
const sessions = new BrowserSessions(join(projectRoot, 'data', 'sessions'));
const manager = await new JobManager(join(projectRoot, 'data', 'jobs'), sessions).init();
let job;
try {
  if (arg('--resume')) job = manager.get(arg('--resume'));
  else {
    let config;
    if (arg('--url')) {
      const report = await scanWebsite(arg('--url'), sessions, progress => console.log(progress.stage));
      console.log(report.message);
      if (['blocked', 'login', 'unknown'].includes(report.capability)) throw new Error('Mở giao diện để xem khả năng cào và đăng nhập nếu cần.');
      config = report.recommendation;
    } else config = JSON.parse(await readFile(arg('--config'), 'utf8'));
    job = await manager.create(config);
  }
  process.on('SIGINT', () => job.pause());
  job.start();
  const timer = setInterval(() => console.log(`${job.progress.stage}: ${job.progress.items} bản ghi, ${job.progress.pages} cụm đã lưu`), 2000);
  await job.promise; clearInterval(timer);
  console.log(`${job.status}: ${job.error || job.progress.stage}\n${await job.export('jsonl')}`);
  if (['failed', 'incomplete'].includes(job.status)) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await manager.close(); }
