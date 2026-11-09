import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createWebMemory} from './web-memory.mjs';

const owner='a'.repeat(32), other='b'.repeat(32);
const miniCam={
  action:'save', category:'project', title:'MiniCam 4G 固定 180 秒播放对照',
  text:'2026-11-07 小包对照的临时 MTU 为 900，实测 MSS 860。固定音源完整播放 180.02 秒，出现 3 次缓存耗尽，最大收包间隔约 7.1 秒。相比默认 MSS 1380 的一轮，最大间隔缩短，重传仍多，未证实根治。下轮保持 8 kbps、三帧打包及 2 秒起播，核对 TCP 与播放日志。',
  keywords:'MiniCam, 4G, MTU, 卡顿, TCP, 重传',
  source:'docs/MINICAM-TCP-FINDINGS.md，2026-11-07 固定音源小包对照'
};
const task=(text='继续排查 MiniCam 的 4G 卡顿',requestId='r1',channel=1)=>({action:'submit',requestId,channel,text});
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'voxi-web-memory-')), file=join(directory,'memory.sqlite');
  let enabled=true,mode='agent',memory;
  const open=()=>createWebMemory(file,async id=>({profile:{id,enabled},agent:{channels:[{mode:'fast'},{mode},{mode:'openclaw'}]}}));
  memory=open();
  t.after(()=>{memory.close();rmSync(directory,{recursive:true,force:true});});
  const sent=[];
  return {get memory(){return memory;}, sent, send:async body=>{sent.push(body);return {task:{id:'saved'}};},
    restart:()=>{memory.close();memory=open();}, disable:()=>{enabled=false;}, openClaw:()=>{mode='openclaw';}};
}

test('web submissions retrieve only the matching owner’s verified MiniCam notes',async t=>{
  const f=fixture(t);
  f.memory.manage(owner,miniCam);
  f.memory.manage(owner,{...miniCam,title:'音色试听',text:'试听 Cove 中英文',keywords:'Cove, 音色'});
  f.memory.manage(other,{...miniCam,title:'另一个用户的保密笔记'});
  const result=await f.memory.forward(f.send,task(),owner);
  assert.deepEqual(result.webMemoryUsed,[miniCam.title]);
  assert.match(f.sent[0].text,/^继续排查 MiniCam 的 4G 卡顿/);
  assert.match(f.sent[0].text,/180\.02 秒/);
  assert.match(f.sent[0].text,/未证实根治/);
  assert.doesNotMatch(f.sent[0].text,/保密笔记|试听 Cove/);
  for(const req of [task('帮我整理桌面文件','r2'),task('这是14G大小的文件','r3'),task('继续查小包 MTU','r4',2)]){
    await f.memory.forward(f.send,req,owner);
    assert.equal(f.sent.at(-1).text,req.text);
  }
  f.disable();
  await f.memory.forward(f.send,task(undefined,'r5'),owner);
  assert.equal(f.sent.at(-1).text,task().text);
});

test('retry is stable across restarts and fails safely after deletion or channel change',async t=>{
  const f=fixture(t);
  const {items:[entry]}=f.memory.manage(owner,miniCam);
  const original=task();
  await f.memory.forward(f.send,original,owner);
  f.restart();
  f.memory.manage(owner,{...miniCam,title:'后补的笔记'});
  await f.memory.forward(f.send,original,owner);
  assert.equal(f.sent[1].text,f.sent[0].text);
  await assert.rejects(f.memory.forward(f.send,task('另一项任务'),owner),/同一请求编号/);
  assert.throws(()=>f.memory.manage(other,{action:'delete',id:entry.id}),/不存在/);
  f.memory.manage(owner,{action:'delete',id:entry.id});
  await assert.rejects(f.memory.forward(f.send,original,owner),/记忆已变更/);
  await f.memory.forward(f.send,task(undefined,'r2'),owner);
  assert.match(f.sent.at(-1).text,/后补的笔记/);
  f.openClaw();
  await assert.rejects(f.memory.forward(f.send,task(undefined,'r2'),owner),/无法确认/);
  assert.equal(f.sent.length,3);
});

test('task text is not truncated to make space for memories',async t=>{
  const f=fixture(t);
  f.memory.manage(owner,miniCam);
  const text='MiniCam '+ '甲'.repeat(7992);
  const original=task(text);
  await f.memory.forward(f.send,original,owner);
  assert.equal(f.sent[0].text,text);
});
