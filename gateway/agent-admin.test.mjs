import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway} from './server.mjs';
import {passwordHash} from './admin-auth.mjs';
import WebSocket,{WebSocketServer} from 'ws';
import {once} from 'node:events';

test('home connector has a fixed scoped relay path without admin or device credentials',async t=>{
 const {openClawRelay}=await import('./openclaw-relay.mjs');let forwarded;
 const handler=openClawRelay(async body=>{forwarded=body;return {job:null};});
 const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const base=`http://127.0.0.1:${server.address().port}`;
 const body={action:'settings',connectionId:'a'.repeat(32),op:'poll',status:'ready'};
 const headers={'Content-Type':'application/json',Authorization:'Bearer '+'x'.repeat(43)};
 assert.equal((await fetch(base,{method:'POST',headers:{...headers,Origin:base},body:JSON.stringify(body)})).status,403);
 assert.equal(forwarded,undefined);
 assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify(body)})).status,200);
 assert.equal(forwarded.action,'relay');assert.equal(forwarded.relayToken,'x'.repeat(43));
 assert.equal((await fetch(base,{method:'POST',headers,body:JSON.stringify({...body,op:'settings'})})).status,400);
});

test('Agent control plane inherits admin login, CSRF and fixed Pocket destination',async t=>{
 const requests=[];
 const backend=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push({path:req.url,auth:req.headers.authorization,body:raw&&JSON.parse(raw)});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({settings:{enabled:false},tasks:[],credentials:{openai:{configured:Boolean(raw),active:false}},runtime:{engine:'codex-pocket-cloud'}}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const {server,wss}=createGateway({mode:'pocket',token:'device-only',adminUsername:'admin',adminPasswordHash:await passwordHash('fixture-password-123'),pocketToken:'private-pocket',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();backend.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/admin/agent','/admin/agent/tasks','/admin/agent/credentials'])assert.equal((await fetch(base+path)).status,200);
 const download=await fetch(base+'/downloads/voxi-openclaw.py');assert.equal(download.status,200);assert.match(await download.text(),/def execute/);
 assert.equal((await fetch(base+'/api/admin/agent',{headers:{Authorization:'Bearer device-only'}})).status,401);
 assert.equal(requests.length,0);
 const login=await fetch(base+'/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-password-123'})});
 const csrf=(await login.json()).csrf,cookie=login.headers.get('set-cookie').split(';')[0];
 const body={action:'credential',provider:'openai',key:'not-a-real-fixture-key'};
 assert.equal((await fetch(base+'/api/admin/agent',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)})).status,401);
 assert.equal(requests.length,0);
 const response=await fetch(base+'/api/admin/agent',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(response.status,200);const result=await response.text();assert.ok(!result.includes(body.key));assert.ok(!result.includes('private-pocket'));
 assert.equal(requests[0].path,'/voxi/agent');assert.equal(requests[0].auth,'Bearer private-pocket');assert.equal(requests[0].body.provider,'openai');
 assert.equal((await fetch(base+'/api/admin/voice-preview',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({voice:'ember'})})).status,401);
 assert.equal((await fetch(base+'/api/admin/voice-preview',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({voice:'ember'})})).status,200);
 assert.equal(requests.at(-1).path,'/voxi/voice-preview');assert.equal(requests.at(-1).body.voice,'ember');
 for(const action of ['status','prepare','probe']){
  assert.equal((await fetch(base+'/api/admin/voice-preview',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({action})})).status,200);
  assert.equal(requests.at(-1).path,'/voxi/voice-preview');assert.equal(requests.at(-1).body.action,action);
 }
});

test('Pocket Agent validation errors reach the administrator without claiming success',async t=>{
 const {pocketSettings}=await import('./pocket-settings.mjs');
 const backend=http.createServer((req,res)=>{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'当前频道未配置 Agent'}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>backend.close());
 const call=pocketSettings({url:`ws://127.0.0.1:${backend.address().port}/voxi`,token:'internal'},'agent');
 await assert.rejects(call({action:'submit'}),/当前频道未配置 Agent/);
});

test('persisted bilingual WAV payload crosses the old 1MB preview bound without regeneration',async t=>{
 const {pocketSettings}=await import('./pocket-settings.mjs');let requests=0;
 const backend=http.createServer((req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({voice:'cove',cached:true,audioFormat:'wav',audioBase64:'A'.repeat(1280060)}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>backend.close());
 const preview=pocketSettings({url:`ws://127.0.0.1:${backend.address().port}/voxi`,token:'fixture'},'voice-preview');
 const result=await preview({voice:'cove'});assert.equal(result.cached,true);assert.equal(result.audioBase64.length,1280060);assert.equal(requests,1);
});

test('background task notice bypasses queued PCM without interrupting audio state',async t=>{
 const backend=http.createServer(),upstreams=new WebSocketServer({server:backend});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 let upstream;
 upstreams.on('connection',socket=>{upstream=socket;socket.send(JSON.stringify({type:'ready',channel:0,name:'快问',channelMode:'fast',agentTasks:true}));});
 const {server,wss}=createGateway({mode:'pocket',token:'device',pocketToken:'internal',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device','X-Voxi-Audio-Format':'opus-24000-v1'}});
 t.after(()=>{device.terminate();for(const c of wss.clients)c.terminate();for(const c of upstreams.clients)c.terminate();wss.close();upstreams.close();server.close();backend.close();});
 const ready=new Promise(resolve=>device.on('message',(raw,binary)=>{if(!binary&&JSON.parse(raw).type==='ready')resolve();}));await ready;
 upstream.send(JSON.stringify({type:'audio_start'}));for(let i=0;i<4;i++)upstream.send(Buffer.alloc(24000));
 const notification=once(device,'message');
 const received=new Promise(resolve=>device.on('message',(raw,binary)=>{if(!binary&&JSON.parse(raw).type==='task_state')resolve(JSON.parse(raw));}));
 upstream.send(JSON.stringify({type:'task_state',taskId:'fixture-task',state:'completed',summary:'任务完成'}));
 await notification;
 const packet=await Promise.race([received,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Task status waited behind PCM')),1000);timer.unref();})]);
 assert.equal(packet.taskId,'fixture-task');const socket=[...wss.clients][0];assert.ok(socket.downlinkQueuedBytes()>0);assert.equal(socket.radioBusy,true);
});
