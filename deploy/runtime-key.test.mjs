import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

test('cloud key ignores firmware commits but tracks gateway and server configuration',t=>{
  const base=mkdtempSync(join(tmpdir(),'voxi-runtime-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const repo=join(base,'repo'),config=join(base,'config');
  mkdirSync(repo);mkdirSync(config);
  for(const name of ['gateway','firmware-c6','docs'])mkdirSync(join(repo,name));
  const run=(command,args)=>{
    const r=spawnSync(command,args,{cwd:repo,encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);return r.stdout.trim();
  };
  run('git',['init']);
  const commit=()=>{
    run('git',['add','.']);
    run('git',['-c','core.hooksPath=/dev/null','-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','fixture']);
  };
  writeFileSync(join(repo,'gateway','server.mjs'),'cloud-v1');commit();
  let bash='bash';
  if(process.platform==='win32'){
    const git=spawnSync('where.exe',['git'],{encoding:'utf8'}).stdout.trim().split(/\r?\n/)[0];
    bash=join(dirname(dirname(git)),'bin','bash.exe');
  }
  const posix=p=>p.replaceAll('\\','/');
  const key=()=>run(bash,[posix(fileURLToPath(new URL('./runtime-key.sh',import.meta.url))),posix(repo),'HEAD',posix(config)]);
  const first=key();assert.match(first,/^[a-f0-9]{64}$/);
  writeFileSync(join(repo,'firmware-c6','main.cpp'),'firmware-v2');
  writeFileSync(join(repo,'docs','guide.md'),'docs-v2');commit();
  assert.equal(key(),first);
  writeFileSync(join(repo,'gateway','server.mjs'),'cloud-v2');commit();
  const second=key();assert.notEqual(second,first);
  writeFileSync(join(config,'gateway.env'),'MODE=mock\n');
  assert.notEqual(key(),second);
  const third=key();writeFileSync(join(config,'pocket.enabled'),'');
  assert.notEqual(key(),third);
});
