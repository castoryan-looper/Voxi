import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';

test('image retention protects active, previous, requested and container-used images', {skip:process.platform==='win32'},t=>{
  const root=mkdtempSync(join(tmpdir(),'voxi-retention-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'deploy'));mkdirSync(join(root,'.deploy'));mkdirSync(join(root,'bin'));
  copyFileSync(new URL('./space.sh',import.meta.url),join(root,'deploy','space.sh'));
  const hashes=['a','b','c','d','e'].map(c=>c.repeat(40));
  writeFileSync(join(root,'.deploy','active-tag'),hashes[0]);
  writeFileSync(join(root,'.deploy','previous-tag'),hashes[1]);
  const log=join(root,'operations');writeFileSync(log,'');
  writeFileSync(join(root,'bin','docker'),`#!/usr/bin/env bash
set -eu
case "$1 $2" in
  'image ls') printf '%s\\n' ${hashes.map(h=>`voxi-gateway:${h}`).join(' ')} codex:latest voxi-gateway:ci ;;
  'image inspect') printf 'sha256:%s\\n' "\${@: -1}" ;;
  'ps -aq') if [[ "\${@: -1}" == *${hashes[3]} ]];then echo in-use;fi ;;
  'image rm'|'image prune') printf '%s\\n' "$*" >> "$TEST_LOG" ;;
  *) exit 99 ;;
esac
`,{mode:0o755});
  const env={...process.env,PATH:join(root,'bin')+delimiter+process.env.PATH,TEST_LOG:log,VOXI_IMAGE_TAG:hashes[2]};
  const result=spawnSync('bash',[join(root,'deploy','space.sh'),'--clean-voxi'],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(readFileSync(log,'utf8').trim().split('\n'),[
    `image rm voxi-gateway:${hashes[4]}`,
    'image prune -f --filter label=io.voxi.project=voxi',
  ]);
  // First install or missing state must not guess which old images are safe.
  rmSync(join(root,'.deploy','active-tag'));writeFileSync(log,'');
  const first=spawnSync('bash',[join(root,'deploy','space.sh'),'--clean-voxi'],{env,encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);assert.equal(readFileSync(log,'utf8'),'');
});
