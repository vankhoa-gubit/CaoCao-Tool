import { DatabaseSync } from 'node:sqlite';

// This is a disposable index. Committed page files remain the recovery source.
export class DiskKeyIndex {
  constructor(path) { this.path = path; this.db = null; }
  open() {
    if (this.db) return;
    this.db = new DatabaseSync(this.path);
    // Pages are flushed before these derived keys are inserted. NORMAL preserves
    // SQLite integrity; a lost last index transaction is rebuilt on every resume.
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA wal_autocheckpoint=8192; CREATE TABLE IF NOT EXISTS keys (key TEXT PRIMARY KEY) WITHOUT ROWID;');
    this.find = this.db.prepare('SELECT 1 FROM keys WHERE key=?');
    this.insert = this.db.prepare('INSERT OR IGNORE INTO keys VALUES (?)');
  }
  get size() { return this.db ? this.db.prepare('SELECT count(*) AS n FROM keys').get().n : 0; }
  has(key) { return Boolean(this.find.get(key)); }
  addMany(keys) {
    this.open(); this.db.exec('BEGIN IMMEDIATE');
    try { for (const key of keys) this.insert.run(key); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  clear() { if (this.db) this.db.exec('DELETE FROM keys'); }
  close() { this.db?.close(); this.db = null; this.find = null; this.insert = null; }
}
