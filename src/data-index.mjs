import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonical, checkPage } from './jobs.mjs';
import { getAt } from './config.mjs';
const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');

export async function datasetIndex(job,count=job.progress.pages){
  const path=join(job.directory,'dataset-index.sqlite'),db=new DatabaseSync(path);
  try{
    // This database is derived from checksummed pages. Its WAL transactions can
    // be replayed/rebuilt without making every index page a durability barrier.
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-65536; PRAGMA wal_autocheckpoint=8192; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS meta(name TEXT PRIMARY KEY,value TEXT); CREATE TABLE IF NOT EXISTS records(ordinal INTEGER PRIMARY KEY,page INTEGER NOT NULL,offset INTEGER NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,label TEXT NOT NULL,search TEXT NOT NULL,names TEXT NOT NULL); CREATE INDEX IF NOT EXISTS record_keys ON records(key); CREATE INDEX IF NOT EXISTS record_pages ON records(page,ordinal); CREATE TABLE IF NOT EXISTS fields(page INTEGER NOT NULL,name TEXT NOT NULL,PRIMARY KEY(page,name)) WITHOUT ROWID;');
    const signature=hash({version:3,config:job.config}),old=db.prepare("SELECT value FROM meta WHERE name='config'").get()?.value;
    if(old!==signature){db.exec("DELETE FROM records; DELETE FROM fields; DELETE FROM meta;");db.prepare('INSERT INTO meta VALUES (?,?)').run('config',signature);}
    let indexed=Number(db.prepare("SELECT value FROM meta WHERE name='pages'").get()?.value||0),ordinal=db.prepare('SELECT count(*) n FROM records').get().n;
    const insert=db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?)'),insertField=db.prepare('INSERT OR IGNORE INTO fields VALUES (?,?)');
    for(let pageNumber=indexed+1;pageNumber<=count;pageNumber++){
      const page=checkPage(JSON.parse(await readFile(join(job.directory,'pages',String(pageNumber).padStart(8,'0')+'.json'),'utf8')));
      db.exec('BEGIN IMMEDIATE');
      try{
        // Another request may have indexed this page while its file was being read.
        const latest=Number(db.prepare("SELECT value FROM meta WHERE name='pages'").get()?.value||0);
        if(latest>=pageNumber){db.exec('ROLLBACK');ordinal=db.prepare('SELECT count(*) n FROM records').get().n;continue;}
        const pageFields=new Set();
        for(let offset=0;offset<page.items.length;offset++){
          const record=page.items[offset],key=page.keys?.[offset]||hash(job.config.extract.uniqueKey?[job.config.extract.uniqueKey,getAt(record,job.config.extract.uniqueKey)]:record),label=job.config.extract.uniqueKey&&job.config.extract.uniqueKey!=='_key'?getAt(record,job.config.extract.uniqueKey):key;
          const names=record&&typeof record==='object'&&!Array.isArray(record)?Object.keys(record):['$'];
          for(const name of names)if(pageFields.size<200)pageFields.add(name);
          const display=typeof label==='object'&&label!==null?JSON.stringify(label).slice(0,400):typeof label==='string'?label.slice(0,400):label??null;
          insert.run(ordinal++,pageNumber,offset,key,hash(record),JSON.stringify(display),JSON.stringify(record).toLocaleLowerCase(),JSON.stringify(names));
        }
        for(const name of pageFields)insertField.run(pageNumber,name);
        db.prepare("INSERT INTO meta VALUES ('pages',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value").run(String(pageNumber));db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
    return {path,db,count};
  }catch(error){db.close();throw error;}
}
export async function indexedRecord(job,row,cache={}){
  if(cache.number!==row.page){cache.page=checkPage(JSON.parse(await readFile(join(job.directory,'pages',String(row.page).padStart(8,'0')+'.json'),'utf8')));cache.number=row.page;}
  const page=cache.page;
  return {index:row.ordinal,record:page.items[row.offset],key:page.keys?.[row.offset]};
}
