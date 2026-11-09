import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from './server.mjs';

test('admin child pages support direct navigation and assets without weakening API authentication',async t=>{
 const {server,wss}=createGateway({token:'device'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{wss.close();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
 for(const path of ['/admin/','/admin/devices','/admin/agent','/admin/ai/voice','/admin/events','/admin/account','/admin/devices/esp32-111111111111/memory']){
  const response=await fetch(base+path);assert.equal(response.status,200,path);assert.match(await response.text(),/\/admin\/assets\/admin.js/);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const oldPromptPage=await fetch(base+'/admin/ai/prompts',{redirect:'manual'});
 assert.equal(oldPromptPage.status,302);
 assert.equal(oldPromptPage.headers.get('location'),'/admin/agent#assistant-behavior');
 const js=await fetch(base+'/admin/assets/admin.js');assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);assert.match(await js.text(),/function navigate/);
 const css=await fetch(base+'/admin/assets/admin.css');assert.equal(css.status,200);assert.match(css.headers.get('content-type'),/text\/css/);
 for(const path of ['/admin/unknown','/admin/assets/private.env','/admin/devices/not-a-device/memory'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/api/admin/memory')).status,503);
});
