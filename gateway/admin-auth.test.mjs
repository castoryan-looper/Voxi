import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGateway} from './server.mjs';
import {passwordHash} from './admin-auth.mjs';

test('account login, CSRF, password persistence, invalidation and logout',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'voxi-account-'));const apps=[];
 t.after(async()=>{for(const {server,wss} of apps){wss.close();await new Promise(r=>server.close(r));}rmSync(dir,{recursive:true,force:true});});
 const hash=await passwordHash('initial-password-123');
 async function app(){const gateway=createGateway({token:'device',adminToken:'legacy',adminUsername:'admin',adminPasswordHash:hash,adminStateFile:join(dir,'admin.json')});apps.push(gateway);await new Promise(r=>gateway.server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${gateway.server.address().port}/api/admin/`;}
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

test('both browser login forms redirect safely and recover their sessions after gateway restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'voxi-login-form-')),file=join(dir,'admin.json');
 let gateway;
 async function stop(){
  if(!gateway)return;
  const {server,wss}=gateway;gateway=null;wss.close();
  await new Promise(resolve=>server.close(resolve));
 }
 t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
 const password='fixture-password-123',hash=await passwordHash(password);
 writeFileSync(file+'.users',JSON.stringify({version:1,accounts:[{id:'a'.repeat(32),userId:'b'.repeat(32),
  role:'user',enabled:true,username:'fixture-user',passwordHash:hash}]}));
 async function start(){
  gateway=createGateway({token:'device',adminUsername:'fixture-admin',adminPasswordHash:hash,adminStateFile:file});
  await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${gateway.server.address().port}`;
 }
 let base=await start();
 const login=(role,username,password,returnTo,headers={})=>fetch(base+'/api/'+role+'/login',{method:'POST',
  body:new URLSearchParams({username,password,returnTo}),headers:{Origin:base,'Sec-Fetch-Site':'same-origin',...headers},redirect:'manual'});
 const auths=[];
 for(const [role,path] of [['admin','/admin/agent#assistant-behavior'],['user','/app/channels']]){
  const page=await(await fetch(base+path)).text();
  assert.match(page,new RegExp('method="post" action="/api/'+role+'/login"'));
  assert.match(page,/name="username"[^>]*autocomplete="username"/);
  assert.match(page,/name="password"[^>]*autocomplete="current-password"/);
  const name='fixture-'+role;
  assert.equal((await login(role,name,password,path,{Origin:'https://evil.example'})).status,403);
  const invalid=await login(role,name,'incorrect','//evil.example');
  assert.equal(invalid.status,303);
  assert.equal(invalid.headers.get('location'),(role==='admin'?'/admin/overview':'/app/profile')+'?loginError=invalid');
  assert.equal(invalid.headers.get('set-cookie'),null);
  const response=await login(role,name,password,path);
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),path);
  const header=response.headers.get('set-cookie');
  assert.match(header,/HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  auths.push({role,cookie:header.split(';')[0]});
 }
 await stop();
 base=await start();
 for(const {role,cookie} of auths){
  const url=base+'/api/'+role;
  const response=await fetch(url+'/session',{headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  const {csrf}=await response.json();
  assert.equal((await fetch(url+'/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:'{}'})).status,200);
 }
 await stop();
 base=await start();
 for(const {role,cookie} of auths)assert.equal((await fetch(base+'/api/'+role+'/session',{headers:{Cookie:cookie}})).status,401);
});

test('password login rejects cross-origin requests and limits repeated failures',async t=>{
 const {server,wss}=createGateway({token:'device',adminUsername:'admin',adminPasswordHash:await passwordHash('valid-password-123')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();});const url=`http://127.0.0.1:${server.address().port}/api/admin/login`;
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'wrong'})};
 assert.equal((await fetch(url,{...options,headers:{...options.headers,Origin:'https://evil.example'}})).status,403);
 for(let i=0;i<8;i++)assert.equal((await fetch(url,options)).status,401);
 assert.equal((await fetch(url,options)).status,429);
});
