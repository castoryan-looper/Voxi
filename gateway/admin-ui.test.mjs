import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./admin.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0].replace('restoreSession();','');
function page(){
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',disabled:false,children:[],append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;}});return nodes.get(id);};
  const context=vm.createContext({document:{getElementById:get,createElement:()=>({children:[],style:{},set id(v){this._id=v;nodes.set(v,this);},get id(){return this._id;},append(...v){this.children.push(...v);},textContent:''})},setInterval(){},confirm:()=>true,fetch:()=>{},Date,Number,Math,JSON,Error,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source,context);return {context,get};
}
const status={devices:[{connection:12,channel:2,busy:false,ageMs:10000,inputBytes:48000,lastPongAgoMs:5000}],events:[{at:'2026-11-03T00:00:00Z',event:'device_rejected',reason:'device_limit',connection:13,maxConnections:2}],maxConnections:2,capacity:4,persistent:true,mode:'pocket'};
test('admin login renders status and count controls, saves live change and keeps secret out of storage',async()=>{
  const {context,get}=page();const requests=[];
  context.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>path.endsWith('/status')?status:path.endsWith('/login')?{csrf:'session-csrf'}:{maxConnections:3}};};
  get('secret').value='admin-secret';await get('loginForm').onsubmit({preventDefault(){}});
  assert.equal(get('secret').value,'');assert.equal(get('dashboard').hidden,false);assert.equal(get('online').textContent,1);assert.equal(get('devices').children[0].children[0].textContent,'连接 #12');
  assert.match(get('events').children[0].textContent,/数量达到上限/);
  get('limit').value='3';await get('limitForm').onsubmit({preventDefault(){}});
  assert.equal(JSON.parse(requests.find(r=>r.path.endsWith('/limit')).options.body).maxConnections,3);
  assert.equal(requests.find(r=>r.path.endsWith('/status')).options.headers['X-CSRF-Token'],'session-csrf');
  await get('logout').onclick();assert.equal(get('dashboard').hidden,true);assert.equal(vm.runInContext('token',context),'');
});
test('pending status cannot reopen dashboard after logout',async()=>{
 const {context,get}=page();let resolve;context.fetch=path=>path.endsWith('/logout')?Promise.resolve({ok:true,json:async()=>({ok:true})}):new Promise(r=>resolve=r);
 vm.runInContext("token='session-csrf'",context);const pending=vm.runInContext('refresh()',context);
 await get('logout').onclick();resolve({ok:true,json:async()=>status});await pending;
 assert.equal(get('dashboard').hidden,true);assert.equal(get('login').hidden,false);
});
test('save failure remains visible and re-enables button',async()=>{
  const {context,get}=page();context.fetch=async()=>({ok:false,json:async()=>({error:'保存失败，原数量上限保持不变'})});
  vm.runInContext("token='admin-secret'",context);get('limit').value='3';await get('limitForm').onsubmit({preventDefault(){}});
  assert.match(get('message').textContent,/保存失败/);assert.equal(get('save').disabled,false);
});

 test('AI editor reads real settings, previews unsaved prompt and saves only supported fields',async()=>{
 const {context,get}=page();const settings={systemPrompt:'完整讲故事',channels:Array.from({length:4},(_,i)=>({name:'呼号'+i,persona:'伙伴'})),responseIdleTimeoutSeconds:30,replyEndSilenceMs:1000,mediaStatsIntervalSeconds:10,audioRetransmission:true,audioRecoveryPackets:64};const requests=[];
 context.fetch=async(path,options)=>{requests.push({path,options});if(options.method==='POST')Object.assign(settings,JSON.parse(options.body));return {ok:true,json:async()=>({settings,defaults:settings,runtime:{model:'native',voice:'cove',protocol:'v3',developerInstructions:'Voice only'},applies:'新连接生效'})};};
 vm.runInContext("token='admin-secret'",context);await vm.runInContext('loadAi()',context);assert.equal(get('aiForm').hidden,false);assert.match(get('effectivePrompt').textContent,/完整讲故事/);
 get('systemPrompt').value='改成慢慢讲';get('previewAi').onclick();assert.match(get('effectivePrompt').textContent,/改成慢慢讲/);await get('aiForm').onsubmit({preventDefault(){}});
 const saved=JSON.parse(requests.find(r=>r.options.method==='POST').options.body);assert.equal(saved.systemPrompt,'改成慢慢讲');assert.equal(saved.audioRetransmission,true);assert.equal(saved.audioRecoveryPackets,64);assert.match(get('aiMessage').textContent,/保存成功/);
 });

 test('read button immediately shows loading and recovers after backend failure',async()=>{
 const {context,get}=page();get('aiForm').hidden=true;let resolve;context.fetch=()=>new Promise(r=>resolve=r);vm.runInContext("token='session'",context);
 const pending=get('reloadAi').onclick();assert.equal(get('reloadAi').disabled,true);assert.match(get('aiMessage').textContent,/正在连接/);
 resolve({ok:false,status:502,json:async()=>({error:'请先更新 Pocket 后端以启用 AI 配置'})});await pending;
 assert.equal(get('reloadAi').disabled,false);assert.match(get('aiMessage').textContent,/读取失败/);assert.match(get('aiMessage').textContent,/Pocket/);assert.equal(get('aiForm').hidden,true);
 });
 test('incompatible response is reported instead of leaving an empty editor',async()=>{
 const {context,get}=page();get('aiForm').hidden=true;context.fetch=async()=>({ok:true,json:async()=>({settings:{}})});vm.runInContext("token='session'",context);await get('reloadAi').onclick();assert.match(get('aiMessage').textContent,/格式不兼容/);assert.equal(get('reloadAi').disabled,false);
 });

 test('memory manager reads user, edits profile and renders transcript without HTML injection',async()=>{
 const {context,get}=page();const uid='user-one';const data={users:[{id:uid,name:'Castor',profile:'喜欢科普',enabled:1}],devices:[{id:'esp32-111111111111',user_id:uid}],memories:[{id:'m1',user_id:uid,text:'我喜欢故事',source:'用户转写',created:1}],turns:[{id:'t1',user_id:uid,text:'<script>test</script>',created:1}]};let submitted;
 context.fetch=async(path,options)=>{if(options.body)submitted=JSON.parse(options.body);return {ok:true,json:async()=>data};};vm.runInContext("token='session'",context);await get('loadMemory').onclick();assert.equal(get('memoryPanel').hidden,false);assert.equal(get('memoryName').value,'Castor');assert.match(get('memoryTurns').children[0].children[0].textContent,/<script>/);
 get('memoryName').value='Castor Yan';get('profileForm').onsubmit({preventDefault(){}});await new Promise(r=>setTimeout(r,5));assert.equal(submitted.userId,uid);assert.equal(submitted.name,'Castor Yan');
 });

 test('device memory entry selects owner by immutable ID and keeps offline devices visible',async()=>{
 const {context,get}=page();const data={users:[{id:'one',name:'甲',profile:'',enabled:1},{id:'two',name:'乙',profile:'',enabled:1}],devices:[{id:'esp32-111111111111',user_id:'one',name:'桌面设备'},{id:'esp32-222222222222',user_id:'two',name:'床头设备'}],memories:[],turns:[]};context.fetch=async()=>({ok:true,json:async()=>data});vm.runInContext("token='session'",context);await get('loadMemory').onclick();assert.equal(get('devices').children.length,2);assert.equal(get('devices').children[1].children[0].textContent,'床头设备');assert.equal(get('devices').children[1].children[4].textContent,'离线');await get('devices').children[1].children[5].children[0].onclick();assert.equal(get('memoryUser').value,'two');assert.equal(get('memoryName').value,'乙');assert.match(get('memoryTitle').textContent,/床头设备/);
 });
