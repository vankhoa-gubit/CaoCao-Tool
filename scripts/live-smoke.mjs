import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserSessions, scanWebsite } from '../src/browser.mjs';
import { JobManager } from '../src/jobs.mjs';
import { projectRoot } from '../src/server.mjs';

// Optional live check against a public scraping sandbox; never part of offline tests.
await mkdir(join(projectRoot, '.qa'), { recursive: true });
const directory = await mkdtemp(join(projectRoot, '.qa', 'live-'));
const sessions = new BrowserSessions(join(directory, 'sessions'));
const manager = await new JobManager(join(directory, 'jobs'), sessions).init();
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 60000);
try {
  const report = await scanWebsite('https://books.toscrape.com/', sessions, update => console.log(update.stage), controller.signal, { rounds: 1, waitMs: 600 });
  console.log(JSON.stringify({ capability: report.capability, mode: report.recommendedMode, sampleCount: report.sample.length, actions: report.actions }));
  const job = await manager.create({ ...report.recommendation, limits: { maxRequests: 2, delayMs: 500, timeoutMs: 20000 } });
  job.start(); await job.promise;
  const outputPath = await job.export('json'), records = JSON.parse(await readFile(outputPath, 'utf8'));
  const result = { checkedAt: new Date().toISOString(), url: report.url, capability: report.capability, mode: job.config.kind, status: job.status, pages: job.progress.pages, items: job.progress.items, uniqueUrls: new Set(records.map(record => record.url)).size, titlePresent: records.every(record => Boolean(record.title)), imagesPresent: records.every(record => record.images?.length > 0), error: job.error, outputPath };
  await writeFile(join(projectRoot, '.qa', 'live-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (job.status !== 'limited' || records.length !== 40 || result.uniqueUrls !== 40) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { clearTimeout(timeout); await manager.close(); }
