import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const shell=readFileSync(new URL('./probe-voice.sh',import.meta.url),'utf8').replaceAll('\r','');
const source=shell.match(/<<'JS'[^\n]*\n([\s\S]*?)\nJS/)[1];
async function fixture(t,{version=4,passed=true}={}){
 const actions=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const data of req)raw+=data;
  assert.equal(req.headers.authorization,'Bearer private-fixture-bearer');
  res.setHeader('Content-Type','application/json');
  if(req.url==='/voxi/agent')return res.end(JSON.stringify({runtime:{voicePreviewVersion:version}}));
  const body=JSON.parse(raw);actions.push(body.action);
  res.end(JSON.stringify({running:false,mode:'probe',probe:{voice:'cove',ready:passed?2:0,total:2,passed},
   blockedReason:passed?'':'语音服务拒绝了控制事件',voices:[{id:'cove',samples:[{language:'zh-CN',state:passed?'ready':'failed',...(passed?{}:{error:{code:'control-rejected'}})}]}]}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module'],{cwd:fileURLToPath(new URL('../gateway/',import.meta.url)),
   env:{...process.env,MODE:'pocket',POCKET_URL:`ws://127.0.0.1:${server.address().port}/voxi`,POCKET_DEVICE_TOKEN:'private-fixture-bearer',POCKET_CA_FILE:''},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(source);
 });
 assert.ok(!result.stdout.includes('private-fixture-bearer'));assert.ok(!result.stderr.includes('private-fixture-bearer'));
 return {...result,actions};
}
test('voice diagnostic requests only the two-clip probe, never full preparation',async t=>{
 const result=await fixture(t);assert.equal(result.code,0);assert.deepEqual(result.actions,['probe']);assert.match(result.stdout,/passed automatic language and script checks/);
});
test('voice diagnostic reports common-path failure and exits unsuccessful',async t=>{
 const result=await fixture(t,{passed:false});assert.equal(result.code,1);assert.deepEqual(result.actions,['probe']);assert.match(result.stdout,/control-rejected/);assert.match(result.stdout,/Full-library generation remains gated/);
});
test('voice diagnostic refuses to run against an old backend',async t=>{
 const result=await fixture(t,{version:3});assert.equal(result.code,1);assert.deepEqual(result.actions,[]);assert.match(result.stderr,/version 4 is not deployed/);
});
