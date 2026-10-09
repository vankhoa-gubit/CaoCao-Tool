import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// Queue payloads live on disk. The worker retains at most one page of URLs.
export class FileQueue {
  constructor(directory, handle, update) { Object.assign(this, { directory, handle, update }); }
  open() {
    if (this.db) return;
    this.db = new DatabaseSync(join(this.directory, 'file-queue.sqlite'));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS tasks(page INTEGER PRIMARY KEY, urls TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', files INTEGER DEFAULT 0, errors INTEGER DEFAULT 0); UPDATE tasks SET status='pending' WHERE status='running';");
  }
  enqueue(page, urls) {
    if (!urls.length) return;
    this.open(); this.db.prepare('INSERT OR IGNORE INTO tasks(page,urls) VALUES (?,?)').run(page, JSON.stringify(urls));
  }
  counts() {
    if (!this.db) return null;
    return this.db.prepare("SELECT coalesce(sum(files),0) files, coalesce(sum(errors),0) errors, sum(CASE WHEN status IN ('pending','running') THEN 1 ELSE 0 END) pending FROM tasks").get();
  }
  kick(signal) {
    if (this.task || !this.db || signal.aborted || this.error) return this.task;
    this.task = (async () => {
      while (!signal.aborted) {
        const row = this.db.prepare("SELECT * FROM tasks WHERE status='pending' ORDER BY page LIMIT 1").get();
        if (!row) return;
        this.db.prepare("UPDATE tasks SET status='running' WHERE page=?").run(row.page);
        try {
          const result = await this.handle(row.page, JSON.parse(row.urls), signal);
          this.db.prepare('UPDATE tasks SET status=?,files=?,errors=? WHERE page=?').run(result.errors.length ? 'failed' : 'done', result.files.length, result.errors.length, row.page);
          await this.update(this.counts());
        } catch (error) { this.db.prepare("UPDATE tasks SET status='pending' WHERE page=?").run(row.page); throw error; }
      }
    })().finally(() => { this.task = null; });
    this.task.catch(error => { this.error = error; }); return this.task;
  }
  async finish(signal) {
    if (this.error && !signal.aborted) throw this.error;
    while (!signal.aborted && (this.task || this.counts()?.pending)) {
      await (this.task || this.kick(signal));
      if (this.error && !signal.aborted) throw this.error;
    }
    signal.throwIfAborted();
  }
  retry() { this.open(); this.error = null; this.db.exec("UPDATE tasks SET status='pending' WHERE status='failed'"); }
  async stop() { await Promise.allSettled([this.task]); this.db?.close(); this.db = null; this.error = null; }
}
