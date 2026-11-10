import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createGateway} from './server.mjs';

async function setup(t,options={}){
  const app=createGateway({token:'device-secret',adminToken:'admin-secret',...options});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const c of app.wss.clients)c.terminate();app.wss.close();await new Promise(r=>app.server.close(r));});
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const api=(path,body,secret='admin-secret',extra={})=>fetch(base+'/api/admin/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+secret,...(body?{'Content-Type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const connect=index=>new WebSocket(base.replace('http:','ws:')+'/radio',{headers:{Authorization:'Bearer device-secret','X-Voxi-Audio-Format':'opus-24000-v1','X-Voxi-Device-Id':'esp32-'+String(index).padStart(12,'0')}});
  return {base,api,connect};
}
test('admin authentication is separate from device authentication; cross-origin mutations rejected',async t=>{
  const {base,api}=await setup(t);
  assert.equal((await fetch(base+'/admin/')).status,200);
  for(const secret of ['','device-secret','wrong'])assert.equal((await api('status',null,secret)).status,401);
  assert.equal((await api('disconnect',{connection:1},'admin-secret',{Origin:'https://evil.example'})).status,403);
  assert.equal((await api('overview',null,'device-secret')).status,401);
  assert.deepEqual(await (await api('overview')).json(),{accounts:0,cloud:null,cloudStatus:'disabled'});
  const s=await (await api('status')).json();
  assert.ok(!JSON.stringify(s).includes('secret'));
});
test('disabled admin fails closed',async t=>{
  const {api}=await setup(t,{adminToken:undefined});assert.equal((await api('status')).status,503);
});
test('six devices stay online despite an old saved limit and admin can disconnect one',{timeout:10000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'voxi-admin-'));
  const stateFile=join(dir,'state.json');writeFileSync(stateFile,'{"maxConnections":1}');
  const {api,connect}=await setup(t,{adminStateFile:stateFile});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const clients=Array.from({length:6},(_,index)=>connect(index));
  await Promise.all(clients.map(ws=>new Promise((resolve,reject)=>{
    const ready=data=>{if(JSON.parse(data).type==='ready'){ws.off('message',ready);resolve();}};
    ws.on('message',ready);ws.once('error',reject);ws.once('close',()=>reject(Error('device closed before READY')));
  })));
  const status=await (await api('status')).json();
  assert.equal(status.devices.length,6);
  assert.equal((await api('limit',{maxConnections:1})).status,404);
  const closed=new Promise(r=>clients[0].once('close',r));
  const selected=status.devices.find(device=>device.deviceId==='esp32-000000000000');
  assert.equal((await api('disconnect',{connection:selected.connection})).status,200);
  assert.equal(await closed,1000);
  assert.equal((await (await api('status')).json()).devices.length,5);
  assert.equal((await api('disconnect',{connection:999})).status,404);
});
