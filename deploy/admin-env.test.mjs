import {scryptSync} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

test('admin provisioning preserves device credentials and existing limit and is idempotent',t=>{
  const directory=mkdtempSync(join(tmpdir(),'voxi-env-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const file=join(directory,'gateway.env');const original='DEVICE_TOKEN=device-private\nPOCKET_DEVICE_TOKEN=pocket-private\nMAX_CONNECTIONS=3\nADMIN_TOKEN=\n';writeFileSync(file,original);
  const run=()=>spawnSync(process.platform==='win32'?'python':'python3',['deploy/admin-env.py',file],{encoding:'utf8'});
  let result=run();assert.equal(result.status,0,result.stderr);const first=readFileSync(file,'utf8');
  for(const line of original.split('\n').filter(line=>line&&!line.startsWith('ADMIN_TOKEN=')))assert.ok(first.includes(line));
  const initial=first.match(/^ADMIN_INITIAL_PASSWORD=(.+)$/m)?.[1];const encoded=first.match(/^ADMIN_PASSWORD_HASH=scrypt:([a-f0-9]+):([a-f0-9]+)$/m);assert.ok(initial);assert.ok(encoded);assert.equal(scryptSync(initial,encoded[1],64).toString('hex'),encoded[2]);assert.ok(first.includes('ADMIN_USERNAME=admin'));
  const secret=first.match(/^ADMIN_TOKEN=([a-f0-9]{64})$/m)?.[1];assert.ok(secret);assert.ok(!result.stdout.includes(secret));
  result=run();assert.equal(result.status,0);assert.equal(readFileSync(file,'utf8'),first);
});
