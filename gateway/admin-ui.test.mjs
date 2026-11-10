import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./admin-app.mjs',import.meta.url),'utf8').replace('restoreSession();','');
function page(){
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,textContent:'',disabled:false,children:[],setAttribute(){},removeAttribute(){},append(...v){this.children.push(...v);},replaceChildren(...v){this.children=v;},get options(){return this.children;},reset(){}});return nodes.get(id);};
  const location={pathname:'/admin/devices',hash:'',origin:'http://localhost'};const history={pushState(_a,_b,path){location.pathname=path;},replaceState(_a,_b,path){location.pathname=path;}};
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

test('admin connections are managed separately and appear only for the owning user in channels',async()=>{
 const {context,get}=page(),owner='a'.repeat(32),other='b'.repeat(32),requests=[];
 const data={settings:{enabled:true,channels:[{name:'快问',mode:'fast'}]},runtime:{ready:true},credentials:{},tasks:[],channelOverrides:[],
  users:[{id:owner,name:'甲'},{id:other,name:'乙'}],connections:[],modelConnections:[],
  modelProviders:{deepseek:{name:'DeepSeek',defaultModel:'deepseek-flash',docs:'https://example.test/'},qwen:{name:'千问',defaultModel:'qwen-plus',workspaceRequired:true}}};
 context.fetch=async(path,options)=>{
  if(options.body){
   const body=JSON.parse(options.body);requests.push(body);
   if(body.action==='connect_model')data.modelConnections.push({id:'model-a',user_id:body.userId,name:body.name,model:body.model,provider:body.provider});
   if(body.action==='connect_openclaw')return {ok:true,json:async()=>({connectionId:'claw-a',pairingToken:'fixture-pair-token'})};
   return {ok:true,json:async()=>({connectionId:'model-a'})};
  }
  return {ok:true,json:async()=>data};
 };
 vm.runInContext("token='session';navigate('/admin/connections')",context);
 await vm.runInContext('loadAgent()',context);
 assert.equal(get('agentConnectionsSection').hidden,false);assert.equal(get('agentSection').hidden,true);
 assert.equal(get('connectionEditor').hidden,true);
 get('agentConnectionUser').value=owner;get('agentConnectionUser').onchange();
 assert.equal(get('connectionEditor').hidden,false);
 get('adminModelProvider').value='qwen';get('adminModelProvider').onchange();
 assert.equal(get('adminModelWorkspace').required,true);
 get('adminModelWorkspace').value='ws-fixture';get('adminModelKey').value='fixture-key';
 await get('adminModelForm').onsubmit({preventDefault(){}});
 assert.deepEqual(requests[0],{action:'connect_model',userId:owner,provider:'qwen',name:'千问',model:'qwen-plus',workspace:'ws-fixture',key:'fixture-key'});
 assert.equal(get('adminModelKey').value,'');assert.equal(get('adminModelConnections').children[0].children[0].textContent,'千问');
 get('openclawName').value='家庭助手';get('openclawTransport').value='relay';get('openclawAgent').value='main';
 await get('openclawForm').onsubmit({preventDefault(){}});
 assert.equal(requests[1].userId,owner);assert.equal(get('openclawPairToken').value,'fixture-pair-token');
 get('adminModelKey').value='unsaved';get('adminModelForm').oninput();
 get('agentConnectionUser').value=other;get('agentConnectionUser').onchange();
 assert.equal(get('adminModelKey').value,'');assert.equal(get('adminModelConnections').children.length,0);
 assert.equal(get('openclawPairToken').value,'');assert.equal(get('openclawPairing').hidden,true);
 vm.runInContext("navigate('/admin/agent')",context);await vm.runInContext('loadAgent()',context);
 assert.equal(get('agentConnectionsSection').hidden,true);
 get('agentChannelUser').value=owner;get('agentChannelUser').onchange();
 assert.equal(get('agentChannelsMode0').children.some(o=>o.value==='model:model-a'),true);
 get('agentChannelUser').value=other;get('agentChannelUser').onchange();
 assert.equal(get('agentChannelsMode0').children.some(o=>o.value==='model:model-a'),false);
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

 test('user detail saves the visible profile and renders scoped transcript as text',async()=>{
 const {context,get}=page(),uid='a'.repeat(32);
 const data={profile:{id:uid,name:'Castor',profile:'喜欢科普',enabled:1},devices:[],account:null,memories:[],turns:[{id:'t1',text:'<script>test</script>',created:1}]};
 let submitted;
 context.fetch=async(path,options)=>{
  if(path.endsWith('/memory')&&options.body){submitted=JSON.parse(options.body);return {ok:true,json:async()=>({})};}
  assert.match(path,new RegExp('/users/'+uid+'/'));
  return {ok:true,json:async()=>data};
 };
 vm.runInContext("token='session'",context);
 context.location.pathname='/admin/users/'+uid+'/profile';
 await vm.runInContext('loadUserDetail()',context);
 assert.equal(get('memoryName').value,'Castor');
 get('memoryName').value='Castor Yan';await get('profileForm').onsubmit({preventDefault(){}});
 assert.equal(submitted.userId,uid);assert.equal(submitted.name,'Castor Yan');
 context.location.pathname='/admin/users/'+uid+'/memory';
 await vm.runInContext('loadUserDetail()',context);
 assert.match(get('memoryTurns').children[0].children[0].textContent,/<script>/);
 });

test('user deletion requires opening the panel and typing the exact profile ID',async()=>{
 const {context,get}=page(),uid='a'.repeat(32),requests=[];
 const detail={profile:{id:uid,name:'测试用户',profile:'',enabled:1},devices:[]};
 context.location.pathname='/admin/users/'+uid+'/profile';
 vm.runInContext("token='session'",context);
 context.fetch=async(path,options)=>{
  if(options.body)requests.push(JSON.parse(options.body));
  return {ok:true,json:async()=>path.endsWith('/profile')?detail:path.endsWith('/devices')?{devices:[]}:{profiles:[],accounts:[],directoryAvailable:true}};
 };
 await vm.runInContext('loadUserDetail()',context);
 const submit=()=>get('deleteUserForm').onsubmit({preventDefault(){}});
 get('deleteUserId').value=uid;await submit();
 assert.deepEqual(requests,[]);
 get('deleteUserPanel').open=true;
 get('deleteUserId').value=uid.slice(-6);get('deleteUserId').oninput();await submit();
 assert.equal(get('deleteUser').disabled,true);assert.deepEqual(requests,[]);
 get('deleteUserId').value=uid;get('deleteUserId').oninput();
 assert.equal(get('deleteUser').disabled,false);await submit();
 assert.deepEqual(requests,[{action:'delete',userId:uid,confirmUserId:uid}]);
 assert.equal(context.location.pathname,'/admin/users');
});

test('deleting a user with devices requires explicit selection of every retired device',async()=>{
 const {context,get}=page(),uid='a'.repeat(32),requests=[];
 const devices=[{id:'esp32-111111111111'},{id:'esp32-222222222222'}];
 const detail={profile:{id:uid,name:'测试用户',profile:'',enabled:1},devices};
 context.location.pathname='/admin/users/'+uid+'/profile';
 vm.runInContext("token='session'",context);
 context.fetch=async(path,options)=>{
  if(options.body)requests.push(JSON.parse(options.body));
  return {ok:true,json:async()=>path.endsWith('/profile')?detail:path.endsWith('/devices')?{devices:[]}:{profiles:[],accounts:[],directoryAvailable:true}};
 };
 await vm.runInContext('loadUserDetail()',context);
 get('deleteUserPanel').open=true;get('deleteUserId').value=uid;get('deleteUserId').oninput();
 const [first,second]=get('retireUserDevices').children.map(label=>label.children[0]);
 const submit=()=>get('deleteUserForm').onsubmit({preventDefault(){}});
 first.checked=true;first.onchange();await submit();
 assert.equal(get('deleteUser').disabled,true);assert.deepEqual(requests,[]);
 second.checked=true;second.onchange();await submit();
 assert.deepEqual(requests,[{action:'delete',userId:uid,confirmUserId:uid,retireDeviceIds:devices.map(d=>d.id)}]);
});

 test('legacy device link resolves its owner and loads the unified memory tab',async()=>{
 const {context,get}=page(),uid='b'.repeat(32),deviceId='esp32-222222222222';
 const data={profile:{id:uid,name:'乙',profile:'',enabled:1},devices:[{id:deviceId}],memories:[],turns:[]};
 context.fetch=async path=>({ok:true,json:async()=>path.endsWith('/devices')?{devices:[{id:deviceId,user_id:uid}]}:data});
 vm.runInContext("token='session'",context);
 context.location.pathname='/admin/devices/'+deviceId+'/memory';
 await vm.runInContext("resolveLegacyUser('"+deviceId+"')",context);
 assert.equal(context.location.pathname,'/admin/users/'+uid+'/memory');
 await vm.runInContext('loadUserDetail()',context);
 assert.equal(get('userDetailName').textContent,'乙');
 assert.equal(get('memoryPanel').hidden,false);
 });

 test('page navigation keeps voice separate from assistant settings and guards unsaved changes',async()=>{
 const {context,get}=page();context.fetch=async()=>({ok:false,status:502,json:async()=>({error:'fixture backend offline'})});vm.runInContext("token='session'",context);vm.runInContext("navigate('/admin/ai/voice')",context);assert.equal(context.location.pathname,'/admin/ai/voice');assert.equal(get('aiSection').hidden,false);assert.equal(get('agentSection').hidden,true);assert.equal(get('devicesSection').hidden,true);vm.runInContext('voiceDirty=true',context);context.confirm=()=>false;assert.equal(vm.runInContext("navigate('/admin/devices')",context),false);assert.equal(context.location.pathname,'/admin/ai/voice');context.confirm=()=>true;assert.equal(vm.runInContext("navigate('/admin/devices')",context),true);assert.equal(get('devicesSection').hidden,false);assert.equal(get('aiSection').hidden,true);
 });

test('matching device suffixes stay distinguishable and searchable by the full IDs',async()=>{
 const {context,get}=page(),first='a'.repeat(32),second='b'.repeat(32);
 const deviceA='esp32-d453097e9ec4',deviceB='esp32-d459097e9ec4';
 const profiles=[{id:first,name:'用户 7e9ec4',deviceCount:1},{id:second,name:'用户 7e9ec4',deviceCount:1}];
 const devices=[{id:deviceA,user_id:first,name:'esp32-s3-4G-final'},{id:deviceB,user_id:second,name:''}];
 context.fetch=async path=>({ok:true,json:async()=>path.endsWith('/devices')?{devices}:{profiles,accounts:[],directoryAvailable:true}});
 context.location.pathname='/admin/users';
 vm.runInContext("token='session'",context);
 await get('reloadUserAccounts').onclick();
 const rows=get('userAccounts').children;
 assert.equal(rows.length,2);
 for(const [index,id,device] of [[0,first,deviceA],[1,second,deviceB]]){
  assert.equal(rows[index].children[0].textContent,'用户 · '+device);
  assert.equal(rows[index].children[0].children[0].children[0].textContent,id);
  assert.equal(rows[index].children[4].children[0].href,'/admin/users/'+id+'/profile');
 }
 assert.notEqual(get('newUserProfile').children[1].textContent,get('newUserProfile').children[2].textContent);
 for(const [query,id] of [['esp32-s3-4G-final',first],[second,second],[deviceB,second]]){
  get('userSearch').value=query;get('userSearch').oninput();
  assert.equal(get('userAccounts').children.length,1);
  assert.equal(get('userAccounts').children[0].children[4].children[0].href,'/admin/users/'+id+'/profile');
 }
});
