import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from './server.mjs';
import {passwordHash} from './admin-auth.mjs';

test('account login, CSRF, password persistence, invalidation and logout',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'voxi-account-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const hash=await passwordHash('initial-password-123');
 async function app(){const {server,wss}=createGateway({token:'device',adminToken:'legacy',adminUsername:'admin',adminPasswordHash:hash,adminStateFile:join(dir,'admin.json')});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();});return `http://127.0.0.1:${server.address().port}/api/admin/`;}
 let base=await app();
 const call=(path,body,cookie,csrf)=>fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await fetch(base+'status',{headers:{Authorization:'Bearer legacy'}})).status,401);
 assert.equal((await call('login',{username:'admin',password:'wrong'})).status,401);
 const login=async password=>{const r=await call('login',{username:'admin',password});assert.equal(r.status,200);const header=r.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/Secure/);assert.match(header,/SameSite=Strict/);return {cookie:header.split(';')[0],csrf:(await r.json()).csrf};};
 const a=await login('initial-password-123');const b=await login('initial-password-123');
 assert.equal((await call('status',null,a.cookie)).status,200);
 assert.equal((await call('session',null,a.cookie)).status,200);
 assert.equal((await call('overview',null,a.cookie)).status,200);
 assert.equal((await call('disconnect',{connection:1},a.cookie)).status,401);
 assert.equal((await call('disconnect',{connection:1},a.cookie,a.csrf)).status,404);
 assert.equal((await call('password',{currentPassword:'initial-password-123',newPassword:'short'},a.cookie,a.csrf)).status,400);
 assert.equal((await call('password',{currentPassword:'wrong',newPassword:'replacement-password-456'},a.cookie,a.csrf)).status,401);
 assert.equal((await call('password',{currentPassword:'initial-password-123',newPassword:'replacement-password-456'},a.cookie,a.csrf)).status,200);
 assert.equal((await call('status',null,a.cookie)).status,401);assert.equal((await call('status',null,b.cookie)).status,401);
 const saved=readFileSync(join(dir,'admin.json.account'),'utf8');assert.ok(!saved.includes('replacement-password'));assert.match(saved,/scrypt:/);
 base=await app();assert.equal((await call('login',{username:'admin',password:'initial-password-123'})).status,401);
 const c=await login('replacement-password-456');assert.equal((await call('logout',{},c.cookie,c.csrf)).status,200);assert.equal((await call('session',null,c.cookie)).status,401);
});

test('password login rejects cross-origin requests and limits repeated failures',async t=>{
 const {server,wss}=createGateway({token:'device',adminUsername:'admin',adminPasswordHash:await passwordHash('valid-password-123')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();});const url=`http://127.0.0.1:${server.address().port}/api/admin/login`;
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'wrong'})};
 assert.equal((await fetch(url,{...options,headers:{...options.headers,Origin:'https://evil.example'}})).status,403);
 for(let i=0;i<8;i++)assert.equal((await fetch(url,options)).status,401);
 assert.equal((await fetch(url,options)).status,429);
});
