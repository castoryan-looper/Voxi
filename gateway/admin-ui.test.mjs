import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./admin-app.mjs',import.meta.url),'utf8').replace('restoreSession();','');
function page(){
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',disabled:false,children:[],append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},get options(){return this.children;},reset(){}});return nodes.get(id);};
  const location={pathname:'/admin/devices',hash:'',origin:'http://localhost'};const history={pushState(_a,_b,path){location.pathname=path;}};
  const context=vm.createContext({window:{addEventListener(){}},location,history,URL,document:{addEventListener(){},querySelector(){return null;},getElementById:get,createElement:()=>({children:[],style:{},dataset:{},set id(v){this._id=v;nodes.set(v,this);},get id(){return this._id;},append(...v){this.children.push(...v);},textContent:''})},setInterval(){},confirm:()=>true,fetch:()=>{},Date,Number,Math,JSON,Error,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source,context);return {context,get};
}
const status={devices:[{connection:12,channel:2,busy:false,ageMs:10000,inputBytes:48000,lastPongAgoMs:5000}],events:[{at:'2026-11-03T00:00:00Z',event:'device_opened',connection:12}],mode:'pocket'};
test('admin login renders device status and keeps secret out of storage',async()=>{
  const {context,get}=page();const requests=[];
  context.fetch=async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>path.endsWith('/status')?status:path.endsWith('/login')?{csrf:'session-csrf'}:{devices:[]}};};
  get('secret').value='admin-secret';await get('loginForm').onsubmit({preventDefault(){}});
  assert.equal(get('secret').value,'');assert.equal(get('dashboard').hidden,false);assert.equal(get('online').textContent,'1');assert.equal(get('devices').children[0].children[0].textContent,'连接 #12');
  assert.match(get('events').children[0].textContent,/设备接入/);
  assert.equal(requests.find(r=>r.path.endsWith('/status')).options.headers['X-CSRF-Token'],'session-csrf');
  await get('logout').onclick();assert.equal(get('dashboard').hidden,true);assert.equal(vm.runInContext('token',context),'');
});
test('pending status cannot reopen dashboard after logout',async()=>{
 const {context,get}=page();let resolve;context.fetch=path=>path.endsWith('/logout')?Promise.resolve({ok:true,json:async()=>({ok:true})}):new Promise(r=>resolve=r);
 vm.runInContext("token='session-csrf'",context);const pending=vm.runInContext('refresh()',context);
 await get('logout').onclick();resolve({ok:true,json:async()=>status});await pending;
 assert.equal(get('dashboard').hidden,true);assert.equal(get('login').hidden,false);
});
test('overview shows measured zero distinctly from missing usage and capacity',async()=>{
  const {context,get}=page();context.location.pathname='/admin/';
  context.fetch=async()=>({ok:true,json:async()=>({accounts:2,cloudStatus:'ready',
    cloud:{audience:{users:4,todayTurns:0,voiceTurns:12,voiceInputMs:93000},voice:{occupied:4,available:0},agent:{tasks:5,codexThreads:4,threadsWithUsage:0,totalTokens:null}}})});
  vm.runInContext("token='session-csrf'",context);await vm.runInContext('refreshOverview(true)',context);
  assert.equal(get('overviewUsers').textContent,'4');assert.equal(get('overviewTodayTurns').textContent,'0');
  assert.equal(get('overviewDuration').textContent,'1 分 33 秒');assert.equal(get('overviewAvailable').textContent,'0');
  assert.equal(get('overviewTokens').textContent,'—');assert.equal(get('overviewTokenCoverage').textContent,'0 / 4 个 Voxi Agent 会话有累计记录');
});

test('quick answer settings save only the edited style, independent of voice',async()=>{
 const {context,get}=page();const settings={systemPrompt:'完整讲故事',voice:'cove',audioRecoveryPackets:64},requests=[];
 context.fetch=async(path,options)=>{
  if(options.body){const body=JSON.parse(options.body);requests.push(body);Object.assign(settings,body.patch);}
  return {ok:true,json:async()=>({settings})};
 };
 vm.runInContext("token='session'",context);
 await vm.runInContext('loadFastStyle()',context);
 assert.equal(get('fastStyleForm').hidden,false);
 get('systemPrompt').value='改成慢慢讲';await get('fastStyleForm').onsubmit({preventDefault(){}});
 assert.deepEqual(requests,[{patch:{systemPrompt:'改成慢慢讲'}}]);
 assert.equal(settings.voice,'cove');assert.equal(settings.audioRecoveryPackets,64);
 assert.match(get('fastStyleMessage').textContent,/已保存/);
});

test('the channel editor saves defaults and personal overrides to separate scopes',async()=>{
 const {context,get}=page(),uid='owner';
 const channels=Array.from({length:4},(_,i)=>({name:'频道'+i,mode:i===0?'fast':'agent'}));
 const settings={enabled:true,channels,maxConcurrent:2,instructions:'任务规则'};
 const data={settings,users:[{id:uid,name:'用户'}],tasks:[],connections:[],channelOverrides:[],channelsByUser:{},credentials:{},runtime:{ready:true}};
 const requests=[];
 context.fetch=async(path,options)=>{
  if(options.body){
   const body=JSON.parse(options.body);requests.push(body);
   if(body.action==='settings_patch')Object.assign(settings,body.settings);
   if(body.action==='channels'){data.channelsByUser[uid]=body.channels;data.channelOverrides=[uid];}
   if(body.action==='reset_channels'){delete data.channelsByUser[uid];data.channelOverrides=[];}
  }
  return {ok:true,json:async()=>data};
 };
 vm.runInContext("token='session'",context);
 await vm.runInContext('loadAgent()',context);
 assert.equal(get('agentChannelUser').value,'');assert.equal(get('saveAgentChannels').disabled,true);
 get('agentChannelsName0').value='公共快问';get('agentChannelsForm').oninput();
 await get('agentChannelsForm').onsubmit({preventDefault(){}});
 assert.deepEqual(Object.keys(requests[0].settings),['channels']);
 get('agentChannelUser').value=uid;get('agentChannelUser').onchange();
 assert.equal(get('agentChannelsName0').value,'公共快问');assert.equal(get('restoreAgentChannels').hidden,true);
 get('agentChannelsName0').value='个人快问';get('agentChannelsForm').oninput();
 await get('agentChannelsForm').onsubmit({preventDefault(){}});
 assert.equal(requests[1].action,'channels');assert.equal(requests[1].userId,uid);
 assert.equal(settings.channels[0].name,'公共快问');assert.equal(get('restoreAgentChannels').hidden,false);
 await get('restoreAgentChannels').onclick();
 assert.deepEqual(requests[2],{action:'reset_channels',userId:uid});
 assert.equal(get('agentChannelsName0').value,'公共快问');
});
 test('read button immediately shows loading and recovers after backend failure',async()=>{
 const {context,get}=page();get('aiForm').hidden=true;let resolve;context.fetch=()=>new Promise(r=>resolve=r);vm.runInContext("token='session'",context);
 const pending=get('reloadAi').onclick();assert.equal(get('reloadAi').disabled,true);assert.match(get('aiMessage').textContent,/正在读取/);
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
 const {context,get}=page();const data={users:[{id:'one',name:'甲',profile:'',enabled:1},{id:'two',name:'乙',profile:'',enabled:1}],devices:[{id:'esp32-111111111111',user_id:'one',name:'桌面设备'},{id:'esp32-222222222222',user_id:'two',name:'床头设备'}],memories:[],turns:[]};context.fetch=async()=>({ok:true,json:async()=>data});vm.runInContext("token='session'",context);await get('loadMemory').onclick();assert.equal(get('devices').children.length,2);assert.equal(get('devices').children[1].children[0].textContent,'床头设备');assert.equal(get('devices').children[1].children[4].textContent,'离线');context.location.pathname='/admin/devices/esp32-222222222222/memory';await vm.runInContext("openDeviceMemory('esp32-222222222222',true)",context);assert.equal(get('memoryUser').value,'two');assert.equal(get('memoryName').value,'乙');assert.match(get('memoryTitle').textContent,/床头设备/);
 });

 test('page navigation keeps voice separate from assistant settings and guards unsaved changes',async()=>{
 const {context,get}=page();context.fetch=async()=>({ok:false,status:502,json:async()=>({error:'fixture backend offline'})});vm.runInContext("token='session'",context);vm.runInContext("navigate('/admin/ai/voice')",context);assert.equal(context.location.pathname,'/admin/ai/voice');assert.equal(get('aiSection').hidden,false);assert.equal(get('agentSection').hidden,true);assert.equal(get('devicesSection').hidden,true);vm.runInContext('voiceDirty=true',context);context.confirm=()=>false;assert.equal(vm.runInContext("navigate('/admin/devices')",context),false);assert.equal(context.location.pathname,'/admin/ai/voice');context.confirm=()=>true;assert.equal(vm.runInContext("navigate('/admin/devices')",context),true);assert.equal(get('devicesSection').hidden,false);assert.equal(get('aiSection').hidden,true);
 });
