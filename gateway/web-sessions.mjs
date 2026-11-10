import {createHash,randomBytes} from 'node:crypto';
import {closeSync,openSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

export const SESSION_SECONDS=8*3600;
const digest=value=>createHash('sha256').update(value).digest('hex');
const randomToken=()=>randomBytes(32).toString('hex');

export function createWebSessions({file,capacity,name,path,secure}){
  if(file)closeSync(openSync(file,'a',0o600));
  const db=new DatabaseSync(file||':memory:');
  db.exec(`PRAGMA busy_timeout=2500;
    CREATE TABLE IF NOT EXISTS sessions (
      digest TEXT NOT NULL UNIQUE, owner TEXT NOT NULL, credential TEXT NOT NULL, csrf TEXT NOT NULL, until INTEGER NOT NULL
    );`);
  const read=db.prepare('SELECT owner,credential,csrf,until FROM sessions WHERE digest=? AND until>?');
  const insert=db.prepare('INSERT INTO sessions(digest,owner,credential,csrf,until) VALUES(?,?,?,?,?)');
  const trim=db.prepare('DELETE FROM sessions WHERE rowid IN (SELECT rowid FROM sessions ORDER BY rowid DESC LIMIT -1 OFFSET ?)');
  const expired=db.prepare('DELETE FROM sessions WHERE until<=?');
  const remove=db.prepare('DELETE FROM sessions WHERE digest=?');
  const revoke=db.prepare('DELETE FROM sessions WHERE owner=?');
  return {
    start(owner,credential){
      const now=Date.now(),id=randomToken(),csrf=randomToken();
      db.exec('BEGIN IMMEDIATE');
      try{
        expired.run(now);
        insert.run(digest(id),owner,digest(credential),csrf,now+SESSION_SECONDS*1000);
        trim.run(capacity);
        db.exec('COMMIT');
      }catch(error){
        db.exec('ROLLBACK');
        throw error;
      }
      return {id,csrf};
    },
    get(req){
      const value=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
      if(!value||!/^[a-f0-9]{64}$/.test(value))return null;
      const key=digest(value),session=read.get(key,Date.now());
      return session?{key,...session}:null;
    },
    matches:(session,credential)=>session.credential===digest(credential),
    remove:key=>remove.run(key),
    revoke:owner=>revoke.run(owner),
    cookie:(id,age)=>`${name}=${id}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`,
    close:()=>db.close(),
  };
}
