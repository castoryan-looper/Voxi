import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createGateway} from './server.mjs';
import {passwordHash} from './admin-auth.mjs';

test('authenticated admin proxies AI settings to dedicated Pocket endpoint without exposing bearer',async t=>{
 let saved={systemPrompt:'旧提示词'};const requests=[];
 const backend=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;requests.push({url:req.url,auth:req.headers.authorization,method:req.method});if(raw)saved=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({settings:saved}));});
 await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const {server,wss}=createGateway({mode:'pocket',token:'device',adminUsername:'admin',adminPasswordHash:await passwordHash('fixture-password-123'),pocketToken:'private-backend',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();backend.close();});
 const url=`http://127.0.0.1:${server.address().port}/api/admin/ai`;
 assert.equal((await fetch(url)).status,401);assert.equal(requests.length,0);
 const login=await fetch(url.replace('/ai','/login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'fixture-password-123'})});assert.equal(login.status,200);const csrf=(await login.json()).csrf,cookie=login.headers.get('set-cookie').split(';')[0];
 let response=await fetch(url,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.deepEqual((await response.json()).settings,saved);
 response=await fetch(url,{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify({systemPrompt:'新提示词'.repeat(500)})});
 assert.equal(response.status,200);assert.match(saved.systemPrompt,/新提示词/);
 assert.deepEqual(requests.map(r=>r.url),['/voxi/config','/voxi/config']);assert.ok(requests.every(r=>r.auth==='Bearer private-backend'));
 assert.ok(!(await response.text()).includes('private-backend'));
});
