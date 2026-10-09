// Child processes for controlled fault injection. All output goes to a QA directory.
import { JobManager } from '../../src/jobs.mjs';
import { createApp } from '../../src/server.mjs';
import { join } from 'node:path';

const [mode, directory, url] = process.argv.slice(2);
const config = { request: { url }, extract: { itemsPath: 'items', uniqueKey: 'id' }, pagination: { mode: 'page', param: 'page', hasMorePath: 'more', totalPath: 'total' }, limits: { delayMs: 0 } };
const hold = detail => new Promise(() => {
  process.on('message', () => {});
  process.send(detail);
});
if (mode === 'pages') {
  const manager = await new JobManager(join(directory, 'jobs'), { async closeAll() {} }).init();
  const job = await manager.create(config), persist = job.persist.bind(job);
  job.persist = async () => {
    if (job.progress.pages === 2 && job.status === 'running') await hold({ stage: 'page-before-checkpoint', id: job.id });
    return persist();
  };
  job.start(); await job.promise;
} else if (mode === 'library') {
  const app = await createApp({ dataDirectory: directory });
  const job = await app.manager.createAndStart(config); await job.promise;
  const preview = await app.library.jobPreview(job.id), records = app.datasets.records.bind(app.datasets);
  app.datasets.records = async function* (...args) {
    let count = 0;
    for await (const row of records(...args)) {
      if (count++ === 100) await hold({ stage: 'library-after-transaction', id: job.id });
      yield row;
    }
  };
  app.library.startImport({ token: preview.token });
} else throw new Error('Unknown recovery fixture');
