import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {createUserAccounts} from './user-accounts.mjs';
test('admin lifecycle gates confirmation and enabled receiver; only hashes cross internal API',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'voxi-lifecycle-'));const A='a'.repeat(32),B='b'.repeat(32),id='esp32-111111111111',calls=[];let reject=false;
 const app=createUserAccounts({file:join(dir,'users.json'),agent:async()=>({users:[{id:A},{id:B}],runtime:{userPortalVersion:1}}),portal:async()=>({}),memory:async body=>{calls.push(body);if(reject)throw Error('设备归属已变化');return {ok:true,deviceId:body.deviceId};}});
 t.after(()=>{app.close();rmSync(dir,{recursive:true,force:true});});
 for(const [username,userId] of [['alice',A],['bob',B]])await app.admin({action:'create',username,password:'test-password-123',userId});
 calls.length=0;
 const body={action:'transfer_device',userId:B,sourceUserId:A,deviceId:id,confirmDeviceId:id};
 await assert.rejects(app.admin({...body,confirmDeviceId:'wrong'}));assert.equal(calls.length,0);
 const value=await app.admin(body);assert.match(value.deviceToken,/^[A-Za-z0-9_-]{43}$/);assert.equal(calls[0].keyHash,createHash('sha256').update(value.deviceToken).digest('hex'));assert.ok(!JSON.stringify(calls).includes(value.deviceToken));assert.equal(calls[0].sourceUserId,A);
 reject=true;await assert.rejects(app.admin(body),/归属已变化/);reject=false;
 const accounts=(await app.admin()).accounts;const bob=accounts.find(a=>a.userId===B);await app.admin({action:'enabled',accountId:bob.id,enabled:false});
 await assert.rejects(app.admin(body),/启用/);
 const retired=await app.admin({action:'retire_device',userId:A,deviceId:id,confirmDeviceId:id});assert.equal(retired.deviceId,id);assert.equal(retired.deviceToken,undefined);assert.equal(calls.at(-1).keyHash,undefined);
});
