import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createGateway} from './server.mjs';
import {createAdmin} from './admin.mjs';

async function setup(t,options={}){
  const app=createGateway({token:'device-secret',adminToken:'admin-secret',maxConnections:1,...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of app.wss.clients)c.terminate();app.wss.close();app.server.close();});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const api=(path,body,secret='admin-secret',extra={})=>fetch(base+'/api/admin/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const connect=()=>new WebSocket(base.replace('http:','ws:')+'/radio',{headers:{Authorization:'Bearer device-secret','X-Voxi-Audio-Format':'opus-24000-v1'}});
  return {base,api,connect};
}
test('admin authentication is separate from device authentication; cross-origin mutations rejected',async t=>{
  const {base,api}=await setup(t);
  assert.equal((await fetch(base+'/admin/')).status,200);
  for(const secret of ['','device-secret','wrong'])assert.equal((await api('status',null,secret)).status,401);
  assert.equal((await api('limit',{maxConnections:4},'admin-secret',{Origin:'https://evil.example'})).status,403);
  const s=await (await api('status')).json();assert.equal(s.maxConnections,1);
  assert.ok(!JSON.stringify(s).includes('secret'));
});
test('disabled admin fails closed',async t=>{
  const {api}=await setup(t,{adminToken:undefined});assert.equal((await api('status')).status,503);
});
test('live limit change admits another device, preserves existing sessions when lowered and disconnects selected connection',async t=>{
  const {api,connect}=await setup(t);
  const first=connect();await new Promise(r=>first.once('open',r));
  const rejected=connect();assert.equal(await new Promise(r=>rejected.once('close',r)),1013);
  assert.equal((await api('limit',{maxConnections:2})).status,200);
  const second=connect();await new Promise(r=>second.once('open',r));
  first.send(JSON.stringify({type:'channel',channel:3}));
  await new Promise(r=>setTimeout(r,20));
  let status=await (await api('status')).json();assert.equal(status.devices.length,2);assert.equal(status.devices[0].channel,3);
  assert.ok(status.events.some(e=>e.reason==='device_limit'));
  assert.equal((await api('limit',{maxConnections:1})).status,200);
  assert.equal((await (await api('status')).json()).devices.length,2);
  const closed=new Promise(r=>second.once('close',r));
  assert.equal((await api('disconnect',{connection:status.devices[1].connection})).status,200);
  assert.equal(await closed,1000);
  status=await (await api('status')).json();assert.equal(status.devices.length,1);
  assert.equal((await api('disconnect',{connection:999})).status,404);
  assert.equal((await api('limit',{maxConnections:4})).status,200);
  const third=connect(),fourth=connect(),fifth=connect();await Promise.all([third,fourth,fifth].map(ws=>new Promise(r=>ws.once('open',r))));
  assert.equal((await (await api('status')).json()).devices.length,4);
});
test('invalid limits rejected and persisted limit survives a gateway restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'voxi-admin-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const stateFile=join(dir,'state.json');const {api}=await setup(t,{adminStateFile:stateFile});
  for(const value of [0,-1,5,1.5,'3',null])assert.equal((await api('limit',{maxConnections:value})).status,400);
  assert.equal((await api('limit',{maxConnections:3})).status,200);
  assert.deepEqual(JSON.parse(readFileSync(stateFile,'utf8')),{maxConnections:3});
  const restarted=createAdmin({initialLimit:1,stateFile});assert.equal(restarted.limit,3);
  assert.throws(()=>createAdmin({initialLimit:NaN}));
  writeFileSync(stateFile,'{"maxConnections":99}');assert.throws(()=>createAdmin({stateFile}));
});
test('failed persistence does not change the active limit',async t=>{
  const {api}=await setup(t,{adminStateFile:join(tmpdir(),'nonexistent-voxi-'+Date.now(),'state.json')});
  assert.equal((await api('limit',{maxConnections:3})).status,500);
  assert.equal((await (await api('status')).json()).maxConnections,1);
});
