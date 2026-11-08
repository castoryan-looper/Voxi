import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGateway} from './server.mjs';
import {passwordHash} from './admin-auth.mjs';
const A='a'.repeat(32),B='b'.repeat(32);

test('user accounts persist, stay scoped, cannot elevate, and revoke all sessions on password/reset/disable',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'voxi-users-'));const forwarded=[];
 const backend=http.createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;forwarded.push({path:req.url,auth:req.headers.authorization,body});res.setHeader('Content-Type','application/json');
  if(req.url==='/voxi/agent')res.end(JSON.stringify({users:[{id:A,name:'Alice profile'},{id:B,name:'Bob profile'}],runtime:{userPortalVersion:1}}));
  else if(req.url==='/voxi/portal')res.end(JSON.stringify({role:'user',profile:{id:body.actorUserId},action:body.action}));
  else if(req.url==='/voxi/voice-preview')res.end(JSON.stringify({voice:body.voice,audioFormat:'wav',audioBase64:'fixture-audio'}));
  else{res.statusCode=404;res.end('{}');}
 });await new Promise(r=>backend.listen(0,'127.0.0.1',r));t.after(()=>{backend.close();rmSync(dir,{recursive:true,force:true});});
 const hash=await passwordHash('admin-password-123');const apps=[];
 async function app(){const app=createGateway({mode:'pocket',token:'device',adminUsername:'admin',adminPasswordHash:hash,adminStateFile:join(dir,'admin.json'),pocketToken:'private-internal',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});apps.push(app);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${app.server.address().port}`;}
 t.after(()=>{for(const app of apps){app.wss.close();app.server.close();}});
 let base=await app();
 const call=(path,body,session={})=>fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session.cookie?{Cookie:session.cookie}:{}),...(session.csrf?{'X-CSRF-Token':session.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
 async function login(type,username,password){const r=await call(`/api/${type}/login`,{username,password});assert.equal(r.status,200);const data=await r.json();assert.equal(data.role,type==='admin'?'admin':'user');assert.match(r.headers.get('set-cookie'),/HttpOnly/);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:data.csrf};}
 let admin=await login('admin','admin','admin-password-123');
 assert.equal((await call('/api/admin/users',{action:'create',username:'alice',password:'alice-password-123',userId:A,role:'admin'},admin)).status,400);
 for(const [username,password,userId] of [['alice','alice-password-123',A],['bob','bob-password-123',B]])assert.equal((await call('/api/admin/users',{action:'create',username,password,userId,role:'user'},admin)).status,200);
 let list=await(await call('/api/admin/users',null,admin)).json();assert.equal(list.accounts.length,2);assert.ok(!JSON.stringify(list).includes('scrypt:'));
 const saved=readFileSync(join(dir,'admin.json.users'),'utf8');assert.match(saved,/scrypt:/);assert.ok(!saved.includes('alice-password'));
 let alice=await login('user','alice','alice-password-123');const bob=await login('user','bob','bob-password-123');
 for(const path of ['/api/admin/users','/api/admin/agent','/api/admin/memory','/api/admin/status'])assert.equal((await call(path,null,alice)).status,401);
 assert.equal((await call('/api/user/state',null,admin)).status,401);
 for(const body of [{action:'snapshot',userId:B},{action:'snapshot',actorUserId:B},{action:'snapshot',role:'admin'}])assert.equal((await call('/api/user/action',body,alice)).status,403);
 const state=await(await call('/api/user/state',null,alice)).json();assert.equal(state.profile.id,A);
 const last=forwarded.at(-1);assert.equal(last.path,'/voxi/portal');assert.equal(last.body.actorUserId,A);assert.equal(last.auth,'Bearer private-internal');
 assert.equal((await call('/api/user/voice-preview',{voice:'ember',actorUserId:B},alice)).status,403);
 assert.equal((await call('/api/user/voice-preview',{action:'prepare'},alice)).status,403);
 assert.equal((await call('/api/user/voice-preview',{action:'describe',voice:'cove',style:'forged'},alice)).status,403);
 assert.equal((await call('/api/user/voice-preview',{voice:'ember'},{cookie:alice.cookie})).status,401);
 assert.equal((await call('/api/user/voice-preview',{voice:'ember'},alice)).status,200);
 assert.equal(forwarded.at(-1).path,'/voxi/voice-preview');assert.equal(forwarded.at(-1).body.actorUserId,A);
 assert.equal((await call('/api/user/voice-preview',{voice:'ember',language:'en'},alice)).status,200);
 assert.equal(forwarded.at(-1).body.language,'en');assert.equal(forwarded.at(-1).body.actorUserId,A);
 assert.equal((await call('/api/admin/voice-preview',{voice:'ember'},alice)).status,401);
 assert.equal((await call('/api/user/action',{action:'snapshot'},{cookie:alice.cookie})).status,401);
 assert.equal((await call('/api/user/password',{currentPassword:'alice-password-123',newPassword:'alice-changed-456'},alice)).status,200);
 assert.equal((await call('/api/user/state',null,alice)).status,401);assert.equal((await call('/api/user/state',null,bob)).status,200);
 alice=await login('user','alice','alice-changed-456');const aid=list.accounts.find(a=>a.username==='alice').id;
 assert.equal((await call('/api/admin/users',{action:'enabled',accountId:aid,enabled:false},admin)).status,200);
 assert.equal((await call('/api/user/state',null,alice)).status,401);
 assert.equal((await call('/api/user/login',{username:'alice',password:'alice-changed-456'})).status,401);
 assert.equal((await call('/api/admin/users',{action:'enabled',accountId:aid,enabled:true},admin)).status,200);
 alice=await login('user','alice','alice-changed-456');
 assert.equal((await call('/api/admin/users',{action:'password',accountId:aid,password:'reset-password-789'},admin)).status,200);
 assert.equal((await call('/api/user/state',null,alice)).status,401);
 base=await app();alice=await login('user','alice','reset-password-789');assert.equal((await call('/api/user/state',null,alice)).status,200);
 assert.equal((await call('/api/user/logout',{},alice)).status,200);assert.equal((await call('/api/user/session',null,alice)).status,401);
});

test('user login rejects cross origin and user assets never serve administrative data',async t=>{
 const {server,wss}=createGateway({token:'device'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.close();wss.close();});const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/app','/app/profile','/app/channels','/app/connections','/app/tasks','/app/account']){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),/\/app\/assets\/app.js/);}
 const r=await fetch(base+'/api/user/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({username:'alice',password:'test'})});assert.equal(r.status,403);
 assert.equal((await fetch(base+'/api/user/state',{headers:{Authorization:'Bearer device'}})).status,401);
 for(let i=0;i<8;i++)assert.equal((await fetch(base+'/api/user/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'missing-user',password:'wrong'})})).status,401);
 assert.equal((await fetch(base+'/api/user/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'missing-user',password:'wrong'})})).status,429);
});
