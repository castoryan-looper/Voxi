
const $=id=>document.getElementById(id);let token='',polling=false,voiceDescriptionDirty=false,voiceDirty=false,voiceRuntimeDirty=false,fastStyleDirty=false;
async function api(path,body,{timeoutMs=12000,signal}={}){
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),timeoutMs);const cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
 try{const response=await fetch('/api/admin/'+path,{method:body?'POST':'GET',credentials:'same-origin',signal:controller.signal,headers:{'X-CSRF-Token':token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});let data;try{data=await response.json();}catch{throw Error('服务返回了非 JSON 响应（HTTP '+response.status+'），请更新网关后重试');}if(!response.ok)throw Error(data.error||'请求失败（HTTP '+response.status+'）');return data;}catch(e){if(e.name==='AbortError')throw Error('请求超过'+Math.round(timeoutMs/1000)+'秒未完成，请检查云端服务后重试');throw e;}finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
}
function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
const labels={user_account_changed:'用户账户已更新',device_limit:'数量达到上限',unauthorized:'设备令牌被拒绝',device_opened:'设备接入',device_closed:'设备断开',limit_changed:'上限已调整',admin_disconnected:'管理员断开连接',ai_config_changed:'AI 配置已保存',memory_changed:'用户记忆已更新'};
async function refresh(){if(polling||!token)return;polling=true;const requestToken=token;try{const s=await api('status');if(token!==requestToken)return;$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;$('navigation').hidden=false;$('breadcrumb').hidden=false;$('online').textContent=s.devices.length;$('limitValue').textContent=s.maxConnections;$('available').textContent=Math.max(0,s.maxConnections-s.devices.length);if(document.activeElement!==$('limit'))$('limit').value=s.maxConnections;$('limit').max=s.capacity;$('capacity').textContent=`可设置 1–${s.capacity} 台。${s.persistent?'配置已启用持久保存，重启后保留。':'当前未启用持久保存。'} 运行模式：${s.mode}`;let registryError='';lastConnections=s.devices;renderDevices();try{const registry=await api('devices');if(token===requestToken&&Array.isArray(registry.devices)){deviceRegistryData=registry.devices;renderDevices();}}catch(e){registryError=' · 设备档案读取失败：'+e.message;}$('events').replaceChildren();for(const e of s.events){const li=document.createElement('li');li.textContent=new Date(e.at).toLocaleTimeString()+' · '+(labels[e.reason]||labels[e.event]||e.event)+(e.connection?' · #'+e.connection:'')+(e.origin?' · '+e.origin:'')+(e.maxConnections?' · 上限 '+e.maxConnections:'');$('events').append(li);}$('updated').textContent='更新于 '+new Date().toLocaleTimeString()+registryError;$('message').textContent='';renderPage();}catch(e){if(token===requestToken)$('message').textContent=e.message;}finally{polling=false;}}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('loginButton').disabled=true;try{const data=await api('login',{username:$('username').value.trim(),password:$('secret').value});token=data.csrf;$('secret').value='';await refresh();}catch(e){$('message').textContent=e.message;}finally{$('loginButton').disabled=false;}};
$('limitForm').onsubmit=async e=>{e.preventDefault();$('save').disabled=true;try{await api('limit',{maxConnections:Number($('limit').value)});await refresh();}catch(e){$('message').textContent=e.message;}finally{$('save').disabled=false;}};
function showLogin(){adminVoicePlayer?.stop(null);voiceDescriptionDirty=false;userAccountsDirty=false;$('newUserPassword').value='';$('userAccounts').replaceChildren();agentGeneration++;agentData=null;agentDirty=false;agentDetail=null;$('credentialKey').value='';$('openclawToken').value='';$('openclawPairToken').value='';$('openclawPairing').hidden=true;channelDirty=false;serviceDirty=false;connectionDirty=false;$('agentTaskDetail').hidden=true;$('agentTasks').replaceChildren();$('agentDetailResult').textContent='';currentRoute='';$('navigation').hidden=true;$('breadcrumb').hidden=true;memoryData=null;deviceRegistryData=[];lastConnections=[];$('memorySection').hidden=true;$('memoryPanel').hidden=true;$('memoryFacts').replaceChildren();$('memoryTurns').replaceChildren();token='';discardEdits();$('aiForm').hidden=true;$('dashboard').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('message').textContent='';}
$('refresh').onclick=refresh;$('logout').onclick=async()=>{try{await api('logout',{});showLogin();}catch(e){$('message').textContent=e.message;}};setInterval(refresh,5000);
$('passwordForm').onsubmit=async e=>{e.preventDefault();$('changePassword').disabled=true;try{await api('password',{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});$('currentPassword').value='';$('newPassword').value='';showLogin();$('message').textContent='密码已修改，请重新登录。';}catch(e){$('message').textContent=e.message;}finally{$('changePassword').disabled=false;}};
async function restoreSession(){try{const data=await api('session');token=data.csrf;await refresh();}catch{showLogin();}}
function fillVoiceSettings(value){
 $('voiceChoice').value=value.voice||'cove';$('stallSeconds').value=value.responseIdleTimeoutSeconds;
 $('endSilence').value=value.replyEndSilenceMs;$('statsSeconds').value=value.mediaStatsIntervalSeconds;
 $('audioRetransmission').checked=value.audioRetransmission;$('audioRecoveryPackets').value=value.audioRecoveryPackets;
}
function validateAiResponse(data){if(typeof data?.settings?.systemPrompt!=='string')throw Error('后端配置格式不兼容，请更新 Pocket Cloud');}
async function saveAiPatch(patch){
 const data=await api('ai',{patch});validateAiResponse(data);
 if(Object.entries(patch).some(([key,value])=>data.settings[key]!==value))throw Error('云端未确认此次修改，请重新读取');
}
async function loadAi(){
 const session=token,route=routeGeneration;
 $('reloadAi').disabled=true;$('aiMessage').textContent='正在读取云端音色设置…';
 try{
  const data=await api('ai');if(token!==session||route!==routeGeneration)return;
  validateAiResponse(data);fillVoiceCatalog(data.voices);fillVoiceSettings(data.settings);updateVoiceDetails();
  voiceDirty=voiceRuntimeDirty=voiceDescriptionDirty=false;
  $('aiForm').hidden=$('voiceRuntimeForm').hidden=false;$('aiMessage').textContent='';$('voiceRuntimeMessage').textContent='';
 }catch(error){if(token===session&&route===routeGeneration)$('aiMessage').textContent='读取失败：'+error.message;}
 finally{if(route===routeGeneration)$('reloadAi').disabled=false;}
}
async function loadFastStyle(){
 const session=token,route=routeGeneration;$('fastStyleForm').hidden=true;
 $('fastStyleMessage').textContent='正在读取…';
 try{
  const data=await api('ai');if(token!==session||route!==routeGeneration)return;
  validateAiResponse(data);$('systemPrompt').value=data.settings.systemPrompt;fastStyleDirty=false;
  $('fastStyleForm').hidden=false;$('fastStyleMessage').textContent='';
 }catch(error){if(token===session&&route===routeGeneration)$('fastStyleMessage').textContent='读取失败：'+error.message;}
}
$('reloadAi').onclick=()=>{if(voiceDirty||voiceRuntimeDirty||voiceDescriptionDirty){if(!confirm('重新读取会丢弃尚未保存的语音设置，继续吗？'))return;}return loadAi();};
$('fastStyleForm').oninput=()=>{fastStyleDirty=true;};
$('voiceRuntimeForm').oninput=()=>{voiceRuntimeDirty=true;};
for(const id of ['voiceStyleDescription','voiceStyleUseCase'])$(id).oninput=()=>{voiceDescriptionDirty=true;$('voiceDescriptionStatus').textContent='说明尚未保存。';};

async function submitAiPatch(button,message,patch,onSaved){
 const session=token,route=routeGeneration;$(button).disabled=true;$(message).textContent='正在保存…';
 try{
  await saveAiPatch(patch);
  if(token===session&&route===routeGeneration){onSaved();$(message).textContent='已保存。';}
 }catch(error){if(token===session&&route===routeGeneration)$(message).textContent='保存失败：'+error.message;}
 finally{$(button).disabled=false;}
}
$('fastStyleForm').onsubmit=e=>{e.preventDefault();const prompt=$('systemPrompt').value;
 return submitAiPatch('saveFastStyle','fastStyleMessage',{systemPrompt:prompt},()=>{fastStyleDirty=$('systemPrompt').value!==prompt;});
};
$('aiForm').onsubmit=e=>{e.preventDefault();const voice=$('voiceChoice').value;
 return submitAiPatch('saveAi','aiMessage',{voice},()=>{voiceDirty=$('voiceChoice').value!==voice;});
};
function readVoiceRuntime(){return {
 responseIdleTimeoutSeconds:Number($('stallSeconds').value),replyEndSilenceMs:Number($('endSilence').value),
 mediaStatsIntervalSeconds:Number($('statsSeconds').value),audioRetransmission:$('audioRetransmission').checked,
 audioRecoveryPackets:Number($('audioRecoveryPackets').value)
};}
$('voiceRuntimeForm').onsubmit=e=>{e.preventDefault();const patch=readVoiceRuntime();
 return submitAiPatch('saveVoiceRuntime','voiceRuntimeMessage',patch,()=>{voiceRuntimeDirty=JSON.stringify(readVoiceRuntime())!==JSON.stringify(patch);});
};
let memoryData=null,memoryBusy=false,deviceRegistryData=[],lastConnections=[],memoryDirty=false,activeDeviceId='',memoryReadPromise=null;
function renderDevices(){
 $('devices').replaceChildren();const registered=new Map(deviceRegistryData.map(d=>[d.id,d]));const rows=lastConnections.map(c=>({...registered.get(c.deviceId),...c,id:c.deviceId,online:true}));for(const d of deviceRegistryData)if(!lastConnections.some(c=>c.deviceId===d.id))rows.push({...d,online:false});
 for(const d of rows){const tr=document.createElement('tr');cell(tr,d.name|| (d.id?'未命名设备':'连接 #'+d.connection));cell(tr,d.id||'旧固件无唯一 ID');cell(tr,d.user_name||'—');cell(tr,d.online&&d.channel!==null?(d.channelMode?'CH'+d.channel+' · '+(d.channelName||d.channelMode):d.channel+1):'—');cell(tr,d.online?(d.busy?'对话中':'在线'):'离线');const actions=cell(tr,'');
 if(d.id){const memory=document.createElement('button');memory.className='secondary';memory.textContent='长期记忆';memory.onclick=()=>openDeviceMemory(d.id);actions.append(memory);const rename=document.createElement('button');rename.className='secondary';rename.textContent='改名';rename.disabled=!d.user_id;rename.onclick=async()=>{const name=prompt('设备名称（唯一 ID 不变）',d.name||'');if(name===null)return;rename.disabled=true;try{const data=await api('memory',{action:'rename_device',deviceId:d.id,userId:d.user_id,name});deviceRegistryData=data.devices.map(x=>({...x,user_name:data.users.find(u=>u.id===x.user_id)?.name||''}));renderDevices();}catch(e){$('message').textContent='改名失败：'+e.message;}finally{rename.disabled=false;}};actions.append(rename);}
 if(d.online){const disconnect=document.createElement('button');disconnect.className='danger';disconnect.textContent='断开';disconnect.onclick=async()=>{if(!confirm('断开此设备当前连接？开机设备会自动重连。'))return;disconnect.disabled=true;try{await api('disconnect',{connection:d.connection});await refresh();}catch(e){$('message').textContent=e.message;}finally{disconnect.disabled=false;}};actions.append(disconnect);}$('devices').append(tr);}
 if(!rows.length){const tr=document.createElement('tr');cell(tr,'暂无设备').colSpan=6;$('devices').append(tr);}
}
async function openDeviceMemory(identifier,fromRoute=false){if(!fromRoute){if(!navigate('/admin/devices/'+encodeURIComponent(identifier)+'/memory'))return;return;}activeDeviceId=identifier;$('memorySection').hidden=false;$('memoryTitle').textContent='长期记忆 · '+(deviceRegistryData.find(d=>d.id===identifier)?.name||identifier);$('memoryMessage').textContent='正在读取此设备绑定的用户…';const data=await loadMemory();if(!data||currentPage().key!=='memory'||currentPage().deviceId!==identifier)return;const device=data.devices.find(d=>d.id===identifier);if(!device){$('memoryMessage').textContent='设备尚未完成用户绑定，请等待新版固件连接后重试。';return;}$('memoryUser').value=device.user_id;memoryRender();$('memoryDeviceIdentity').textContent='唯一 ID：'+identifier;}
function memoryUserId(){return $('memoryUser').value;}
function memoryRender(){const uid=memoryUserId(),u=memoryData?.users.find(x=>x.id===uid);if(!u){$('memoryPanel').hidden=true;return;}$('memoryPanel').hidden=false;$('memoryName').value=u.name;$('memoryProfile').value=u.profile;$('memoryEnabled').checked=Boolean(u.enabled);$('boundDevices').textContent='绑定设备：'+memoryData.devices.filter(d=>d.user_id===uid).map(d=>d.id).join('、');$('memoryDevice').replaceChildren();for(const d of memoryData.devices){const option=document.createElement('option');option.value=d.id;option.textContent=d.id;$('memoryDevice').append(option);}$('memoryFacts').replaceChildren();for(const m of memoryData.memories.filter(x=>x.user_id===uid)){const box=document.createElement('div');box.className='card';const text=document.createElement('textarea');text.value=m.text;text.maxLength=1000;text.oninput=()=>{memoryDirty=true;};const source=document.createElement('small');source.textContent=m.source+' · '+new Date(m.created*1000).toLocaleString();const save=document.createElement('button');save.textContent='保存修改';save.onclick=()=>memoryChange({action:'memory',id:m.id,text:text.value});const del=document.createElement('button');del.className='danger';del.textContent='删除';del.onclick=()=>{if(confirm('删除这条记忆并清除当前对话上下文？'))memoryChange({action:'delete_memory',id:m.id});};box.append(source,text,save,del);$('memoryFacts').append(box);}$('memoryTurns').replaceChildren();for(const t of memoryData.turns.filter(x=>x.user_id===uid)){const box=document.createElement('div');const p=document.createElement('p');p.textContent=new Date(t.created*1000).toLocaleString()+' · '+t.text;const del=document.createElement('button');del.textContent='删除此条';del.className='secondary';del.onclick=()=>memoryChange({action:'delete_turn',id:t.id});box.append(p,del);$('memoryTurns').append(box);}}
function memoryFill(data){const selected=memoryUserId();memoryData=data;deviceRegistryData=data.devices.map(d=>({...d,user_name:data.users.find(u=>u.id===d.user_id)?.name||''}));renderDevices();$('memoryUser').replaceChildren();for(const u of data.users){const option=document.createElement('option');option.value=u.id;option.textContent=u.name;$('memoryUser').append(option);}$('memoryUser').value=data.users.some(u=>u.id===selected)?selected:(data.users[0]?.id||'');memoryRender();memoryDirty=false;$('memoryMessage').textContent=(data.users.length?'读取成功。':'暂无带设备编号的新连接，请更新固件并连接云端。')+' 后台待转写 '+(data.pendingTranscriptions||0)+' 条。'+(data.lastError||'')+' '+(data.policy||'');}
async function loadMemory(){if(memoryReadPromise)return memoryReadPromise;if(memoryBusy)return;memoryReadPromise=(async()=>{memoryBusy=true;$('loadMemory').disabled=true;$('memoryMessage').textContent='正在读取用户档案与记忆…';const requested=token;try{const data=await api('memory');if(token===requested){memoryFill(data);return data;}}catch(e){if(token===requested)$('memoryMessage').textContent='读取失败：'+e.message;}finally{memoryBusy=false;$('loadMemory').disabled=false;}})();try{return await memoryReadPromise;}finally{memoryReadPromise=null;}}
async function memoryChange(change){if(memoryBusy)return;memoryBusy=true;const requested=token;$('memoryMessage').textContent='正在保存…';try{const data=await api('memory',{...change,userId:memoryUserId()});if(requested!==token)return;memoryFill(data);$('memoryMessage').textContent='已保存。修改后的记忆会在设备重新连接时加载。';}catch(e){$('memoryMessage').textContent='保存失败：'+e.message;}finally{memoryBusy=false;}}
$('loadMemory').onclick=loadMemory;$('memoryUser').onchange=memoryRender;
$('profileForm').oninput=()=>{memoryDirty=true;};$('factForm').oninput=()=>{memoryDirty=true;};
$('profileForm').onsubmit=e=>{e.preventDefault();memoryChange({action:'profile',name:$('memoryName').value,profile:$('memoryProfile').value,enabled:$('memoryEnabled').checked});};
$('factForm').onsubmit=e=>{e.preventDefault();memoryChange({action:'memory',text:$('factText').value});};
$('rebindDevice').onclick=()=>{if(confirm('变更这台设备的用户绑定并断开当前对话？'))memoryChange({action:'rebind',deviceId:$('memoryDevice').value});};
$('clearMemory').onclick=()=>{if(confirm('永久清空此用户的背景、记忆和历史，并断开当前对话？'))memoryChange({action:'clear'});};


const pages=[
 {key:'users',path:'/admin/users',title:'用户账户',sections:['usersSection']},
 {key:'agent',path:'/admin/agent',title:'频道与助手',sections:['agentSection']},
 {key:'agentTasks',path:'/admin/agent/tasks',title:'后台任务',sections:['agentTasksSection']},
 {key:'agentCredentials',path:'/admin/agent/credentials',title:'模型密钥',sections:['agentCredentialsSection']},
 {key:'devices',path:'/admin/devices',title:'设备管理',sections:['overviewSection','devicesSection']},
 {key:'voice',path:'/admin/ai/voice',title:'语音与试听',sections:['aiSection']},
 {key:'events',path:'/admin/events',title:'连接事件',sections:['eventsSection']},
 {key:'account',path:'/admin/account',title:'管理员账户',sections:['accountSection']}
];
let currentRoute='',routeGeneration=0;
function currentPage(){const path=location.pathname.replace(/\/$/,'');const device=path.match(/^\/admin\/devices\/(esp32-[a-f0-9]{12})\/memory$/);if(device)return {key:'memory',path,title:'设备长期记忆',sections:['memorySection'],deviceId:device[1]};return pages.find(p=>p.path===path)||pages.find(p=>p.key==='devices');}
function dirty(){return voiceDescriptionDirty||voiceDirty||voiceRuntimeDirty||fastStyleDirty||memoryDirty||agentDirty||userAccountsDirty;}
function discardEdits(){
 voiceDescriptionDirty=voiceDirty=voiceRuntimeDirty=fastStyleDirty=memoryDirty=userAccountsDirty=false;
 channelDirty=serviceDirty=behaviorDirty=connectionDirty=false;updateAgentDirty();
}
function navigate(path){
 if(path===location.pathname)return true;
 if(dirty()&&!confirm('有未保存的修改，离开后将丢弃。继续吗？'))return false;
 discardEdits();history.pushState({},'',path);renderPage(true);return true;
}
function renderPage(force=false){if(!token)return;const page=currentPage();if(!force&&currentRoute===page.path)return;currentRoute=page.path;routeGeneration++;adminVoiceRequest++;adminVoicePlayer?.stop(null);for(const id of ['overviewSection','devicesSection','aiSection','memorySection','eventsSection','accountSection','agentSection','agentTasksSection','agentCredentialsSection'])$(id).hidden=!page.sections.includes(id);$('pageTitle').textContent=page.title;document.title=page.title+' · Voxi 管理后台';$('breadcrumb').textContent=page.key==='memory'?'设备管理 / 长期记忆':'控制台 / '+page.title;for(const p of pages){const link=document.querySelector('[data-nav="'+p.key+'"]');if(link){if(p.key===page.key||(page.key==='memory'&&p.key==='devices'))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}}
 if(page.key==='voice'){$('aiForm').hidden=$('voiceRuntimeForm').hidden=true;loadAi();}
 $('usersSection').hidden=page.key!=='users';if(page.key==='users')loadUserAccounts();
 if(page.key.startsWith('agent'))loadAgent();
 if(page.key==='agent'){
  loadFastStyle();
  if(location.hash==='#assistant-behavior')$('assistant-behavior').scrollIntoView();
 }
 if(page.key==='memory')openDeviceMemory(page.deviceId,true);
}
document.addEventListener('click',event=>{const link=event.target.closest?.('a[href^="/admin/"]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button>0)return;event.preventDefault();navigate(new URL(link.href,location.origin).pathname);});
window.addEventListener('popstate',()=>{if(dirty()&&!confirm('有未保存的修改，离开后将丢弃。继续吗？')){history.pushState({},'',currentRoute);return;}discardEdits();renderPage(true);});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
restoreSession();

let agentData=null,agentDirty=false,agentReadDone=null,agentGeneration=0,agentDetail=null,agentSubmitId=null;
const agentStates={queued:'已保存 · 等待执行',submitting:'正在提交',running:'执行中',needs_input:'需要补充信息',awaiting_approval:'等待确认',cancelling:'正在停止',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',delivery_unknown:'结果未确认'};
function option(value,text){const o=document.createElement('option');o.value=value;o.textContent=text;return o;}
function fillAgentChannels(channels){
 const editor=$('agentChannels'),uid=$('agentChannelUser').value;editor.replaceChildren();
 channels.forEach((channel,index)=>{
  const box=document.createElement('div'),name=document.createElement('input'),mode=document.createElement('select');
  const title=document.createElement('strong'),nameLabel=document.createElement('label'),modeLabel=document.createElement('label');
  box.className='channel-card';title.textContent='CH'+index;
  name.id='agentChannelsName'+index;name.value=channel.name;name.maxLength=32;name.required=true;
  nameLabel.className='field';nameLabel.htmlFor=name.id;nameLabel.textContent='频道名称';
  mode.id='agentChannelsMode'+index;modeLabel.className='field';modeLabel.htmlFor=mode.id;modeLabel.textContent='选择助手';
  for(const [value,text] of [['fast','快问 · 即问即答'],['agent','Voxi Agent · 后台执行'],['disabled','停用']])mode.append(option(value,text));
  if(uid)for(const conn of agentData.connections)if(conn.user_id===uid)mode.append(option('openclaw:'+conn.id,conn.name+' · OpenClaw'));
  const target=channel.mode==='openclaw'?'openclaw:'+channel.connectionId:channel.mode;
  if(channel.mode==='openclaw'&&![...mode.options].some(o=>o.value===target))mode.append(option(target,'连接已失效，请重新选择'));
  mode.value=target;box.append(title,nameLabel,name,modeLabel,mode);editor.append(box);
 });
}
function readAgentChannels(){
 return Array.from({length:4},(_,index)=>{
  const value=$('agentChannelsMode'+index).value,openclaw=value.startsWith('openclaw:');
  return {name:$('agentChannelsName'+index).value.trim(),mode:openclaw?'openclaw':value,...(openclaw?{connectionId:value.slice(9)}:{})};
 });
}
function fillAgentUsers(id){
 const select=$(id),selected=select.value;select.replaceChildren();
 if(id==='agentChannelUser')select.append(option('','默认频道（未自定义的用户）'));
 for(const user of agentData.users)select.append(option(user.id,user.name));
 if(agentData.users.some(user=>user.id===selected)||id==='agentChannelUser')select.value=agentData.users.some(user=>user.id===selected)?selected:'';
}
let channelDirty=false,serviceDirty=false,behaviorDirty=false,connectionDirty=false,selectedChannelUser='',channelSaving=false;
function updateAgentDirty(){agentDirty=channelDirty||serviceDirty||behaviorDirty||connectionDirty;}
function channelControls(){
 $('agentChannelUser').disabled=channelSaving;$('agentChannelFields').disabled=channelSaving;
 $('saveAgentChannels').disabled=channelSaving||!channelDirty;$('restoreAgentChannels').disabled=channelSaving;
}
function renderChannelEditor(){
 const uid=$('agentChannelUser').value,custom=agentData.channelOverrides.includes(uid);
 selectedChannelUser=uid;
 fillAgentChannels(agentData.channelsByUser?.[uid]||agentData.settings.channels);
 $('channelScopeHint').textContent=!uid?'默认频道供未自定义的用户使用。设备会跳过停用的频道。':custom?'此用户使用个人频道，所有绑定设备共用。':'此用户跟随默认频道。修改并保存后，只应用到此用户。';
 $('saveAgentChannels').textContent=uid?'保存此用户的频道':'保存默认频道';
 $('restoreAgentChannels').hidden=!custom;$('agentConnections').hidden=!uid;channelControls();
 renderOpenClawConnections();
}
function agentTaskChannels(){const uid=$('agentTaskUser').value,selected=$('agentTaskChannel').value;$('agentTaskChannel').replaceChildren();const channels=agentData.channelsByUser?.[uid]||agentData.settings.channels;channels.forEach((c,i)=>{if(['agent','openclaw'].includes(c.mode))$('agentTaskChannel').append(option(String(i),'CH'+i+' · '+c.name));});if([...$('agentTaskChannel').options].some(o=>o.value===selected))$('agentTaskChannel').value=selected;$('submitAgentTask').disabled=!uid||!$('agentTaskChannel').options.length||!agentData.settings.enabled;}
function credentialStatus(){if(!agentData)return;const c=agentData.credentials[$('credentialProvider').value];$('credentialState').textContent=c?.configured?'已加密保存 · 当前 Codex 执行器未使用此密钥':'尚未配置 · 当前使用服务器既有 Codex 登录';}
function renderAgentTasks(){$('agentTasks').replaceChildren();for(const task of agentData.tasks){const row=document.createElement('tr');cell(row,task.summary||task.id.slice(0,8));cell(row,(agentData.users.find(u=>u.id===task.user_id)?.name||task.user_id.slice(0,8))+' / CH'+task.channel);cell(row,agentStates[task.state]||task.state);cell(row,new Date(task.updated*1000).toLocaleString());const td=cell(row,''),button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='查看';button.onclick=()=>openAgentTask(task.id,task.user_id);td.append(button);$('agentTasks').append(row);}if(!agentData.tasks.length){const row=document.createElement('tr');cell(row,'还没有任务。可以在上方提交，或从设备 Agent 频道按键说话。');$('agentTasks').append(row);}}
function renderAgentSnapshot(data,refreshEditors){
  if(!data.settings||!Array.isArray(data.tasks)||!Array.isArray(data.users)||!Array.isArray(data.connections)||!Array.isArray(data.channelOverrides))
   throw Error('频道配置需要新版 Pocket Cloud。');
  agentData=data;
  const s=data.settings;
  $('channelServiceStatus').textContent=s.enabled?'频道服务已开启':'频道服务已关闭';
  $('toggleChannelService').textContent=s.enabled?'关闭频道服务':'开启频道服务';
  $('toggleChannelService').hidden=false;$('channelServiceNotice').hidden=s.enabled;
  $('agentRuntime').textContent=(data.runtime.ready?'执行器已连接':data.runtime.lastError||'执行器会在首次任务时连接')+'。使用服务器的 Codex 登录。';
  if(refreshEditors){
   $('agentModel').value=s.model;$('agentConcurrency').value=s.maxConcurrent;$('agentTimeout').value=s.maxTaskSeconds;$('agentInstructions').value=s.instructions;
   fillAgentUsers('agentChannelUser');fillAgentUsers('agentTaskUser');renderChannelEditor();agentTaskChannels();
   $('channelEditor').hidden=$('agentSettingsForm').hidden=$('agentBehaviorForm').hidden=false;
  }else renderOpenClawConnections();
  renderAgentTasks();credentialStatus();
}
async function loadAgent(poll=false){
 if(!token)return;
 if(agentReadDone){await agentReadDone;return loadAgent(poll);}
 let finishRead;agentReadDone=new Promise(resolve=>{finishRead=resolve;});
 const generation=agentGeneration,session=token,route=routeGeneration;
 try{
  const data=await api('agent');if(generation!==agentGeneration||session!==token||route!==routeGeneration)return;
  renderAgentSnapshot(data,!poll);
  if(poll&&agentDetail&&currentPage().key==='agentTasks')await openAgentTask(agentDetail.id,agentDetail.user_id,true);
 }catch(error){if(session===token&&generation===agentGeneration)$(currentPage().key==='agentTasks'?'agentTaskMessage':currentPage().key==='agentCredentials'?'credentialMessage':'agentMessage').textContent=error.message;}
 finally{agentReadDone=null;finishRead();}
}
async function agentMutation(body){const requested=token,result=await api('agent',body);if(requested!==token)throw Error('会话已退出');return result;}
$('reloadAgent').onclick=()=>{
 if((agentDirty||fastStyleDirty)&&!confirm('重新读取会丢弃尚未保存的修改，继续吗？'))return;
 channelDirty=serviceDirty=behaviorDirty=connectionDirty=fastStyleDirty=false;updateAgentDirty();
 $('openclawToken').value='';$('openclawPairToken').value='';$('openclawPairing').hidden=true;
 $('agentMessage').textContent='';loadAgent();loadFastStyle();
};
$('refreshAgentTasks').onclick=()=>loadAgent(true);
$('agentSettingsForm').oninput=()=>{serviceDirty=true;updateAgentDirty();};
$('agentBehaviorForm').oninput=()=>{behaviorDirty=true;updateAgentDirty();};
$('agentChannelsForm').oninput=()=>{channelDirty=true;updateAgentDirty();channelControls();};

async function submitAgentSettings(button,message,settings,onSaved){
 const session=token,route=routeGeneration;
 $(button).disabled=true;$(message).textContent='正在保存…';
 try{
  const data=await agentMutation({action:'settings_patch',settings});
  if(agentReadDone)await agentReadDone;
  if(token!==session||route!==routeGeneration)return;
  renderAgentSnapshot(data,false);onSaved?.();updateAgentDirty();$(message).textContent='已保存。';
 }catch(error){if(token===session&&route===routeGeneration)$(message).textContent='保存失败：'+error.message;}
 finally{$(button).disabled=false;}
}
$('toggleChannelService').onclick=()=>{
 if(!agentData)return;
 const enabled=!agentData.settings.enabled;
 if(!enabled&&!confirm('关闭后，设备会使用旧版语音频道。已经接收的任务会继续运行。确定关闭？'))return;
 return submitAgentSettings('toggleChannelService','agentMessage',{enabled},()=>{agentTaskChannels();});
};
function readAgentRuntime(){return {model:$('agentModel').value.trim(),maxConcurrent:Number($('agentConcurrency').value),maxTaskSeconds:Number($('agentTimeout').value)};}
$('agentSettingsForm').onsubmit=event=>{
 event.preventDefault();const settings=readAgentRuntime();
 return submitAgentSettings('saveAgentSettings','agentSettingsMessage',settings,()=>{serviceDirty=JSON.stringify(readAgentRuntime())!==JSON.stringify(settings);});
};
$('agentBehaviorForm').onsubmit=event=>{
 event.preventDefault();const instructions=$('agentInstructions').value;
 return submitAgentSettings('saveAgentBehavior','agentBehaviorMessage',{instructions},()=>{behaviorDirty=$('agentInstructions').value!==instructions;});
};
$('agentChannelUser').onchange=()=>{
 if((channelDirty||connectionDirty)&&!confirm('切换配置对象会丢弃尚未保存的频道或连接编辑，继续吗？')){$('agentChannelUser').value=selectedChannelUser;return;}
 channelDirty=connectionDirty=false;updateAgentDirty();
 $('openclawForm').reset();openclawTransport();$('openclawPairToken').value='';$('openclawPairing').hidden=true;
 $('agentConnections').open=false;$('agentMessage').textContent='';$('openclawMessage').textContent='';
 renderChannelEditor();
};
$('agentTaskUser').onchange=agentTaskChannels;
async function saveChannelScope(body,message){
 const session=token,route=routeGeneration;
 channelSaving=true;channelControls();
 try{
  const data=await agentMutation(body);
  if(agentReadDone)await agentReadDone;
  if(token!==session||route!==routeGeneration)return;
  renderAgentSnapshot(data,false);channelDirty=false;updateAgentDirty();
  renderChannelEditor();agentTaskChannels();$('agentMessage').textContent=message;
 }catch(error){if(token===session&&route===routeGeneration)$('agentMessage').textContent='保存失败：'+error.message;}
 finally{channelSaving=false;channelControls();}
}
$('agentChannelsForm').onsubmit=event=>{
 event.preventDefault();if(!channelDirty||channelSaving)return;
 const userId=$('agentChannelUser').value,channels=readAgentChannels();
 return saveChannelScope(userId?{action:'channels',userId,channels}:{action:'settings_patch',settings:{channels}},
  userId?'已保存此用户的频道。':'已保存默认频道。');
};
$('restoreAgentChannels').onclick=()=>{
 const userId=$('agentChannelUser').value;
 if(userId&&!channelSaving&&confirm('恢复此用户的默认频道？现有个人频道设置会被替换。'))
  return saveChannelScope({action:'reset_channels',userId},'已恢复默认频道。');
};
$('agentSubmitForm').oninput=()=>{agentSubmitId=null;};
$('agentSubmitForm').onsubmit=async event=>{event.preventDefault();$('submitAgentTask').disabled=true;try{agentSubmitId ||= crypto.randomUUID();const data=await agentMutation({action:'submit',userId:$('agentTaskUser').value,channel:Number($('agentTaskChannel').value),requestId:agentSubmitId,text:$('agentTaskText').value});$('agentTaskText').value='';agentSubmitId=null;$('agentTaskMessage').textContent='任务已保存；不需要保持此网页或设备在线。';await loadAgent(true);await openAgentTask(data.task.id,data.task.user_id);}catch(error){$('agentTaskMessage').textContent=error.message+'。内容未修改时重试沿用同一请求编号，避免重复提交。';}finally{if(agentData)agentTaskChannels();}};
async function agentTaskAction(action,extra={}){if(!agentDetail)return;const task=agentDetail;try{const data=await agentMutation({action,userId:task.user_id,taskId:task.id,...extra});await loadAgent(true);await openAgentTask(data.task.id,data.task.user_id);$('agentTaskMessage').textContent='操作已提交。';}catch(error){$('agentTaskMessage').textContent=error.message;}}
async function openAgentTask(id,user,poll=false){const requested=token;try{const data=await api('agent',{action:'detail',userId:user,taskId:id});if(requested!==token)return;const task=data.task;agentDetail=task;$('agentTaskDetail').hidden=false;$('agentDetailTitle').textContent='任务 '+id.slice(0,8);$('agentDetailState').textContent=(agentStates[task.state]||task.state)+' · '+task.summary;$('agentDetailPrompt').textContent=task.prompt;$('agentDetailResult').textContent=task.result||'尚无最终回复。';$('agentUsage').textContent=task.usage?'执行器报告 token：输入 '+(task.usage.input_tokens??'未知')+' / 输出 '+(task.usage.output_tokens??'未知')+'；未换算为 API 费用。':'执行器尚未报告用量；不生成估算账单。';$('agentTaskEvents').replaceChildren();for(const e of task.events||[]){const li=document.createElement('li');li.textContent=new Date(e.created*1000).toLocaleTimeString()+' · '+(agentStates[e.state]||e.state)+' · '+e.summary;$('agentTaskEvents').append(li);}
 if(poll&&$('agentApproval').contains(document.activeElement))return;
 $('agentTaskActions').replaceChildren();$('agentApproval').replaceChildren();
 const button=(label,action,cls='secondary')=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.className=cls;b.onclick=action;$('agentTaskActions').append(b);};
 if(['queued','running','awaiting_approval','needs_input'].includes(task.state)||(task.engine==='openclaw'&&task.state==='submitting'))button(task.engine==='openclaw'?'停止等待／核对远端':'取消任务',()=>{if(confirm(task.engine==='openclaw'?'停止等待后，请在 OpenClaw 核对或停止远端任务。继续吗？':'请求停止此任务？已经产生的修改不会自动撤销。'))agentTaskAction('cancel');},'danger');
 if(task.state==='awaiting_approval'){const pre=document.createElement('pre');pre.textContent=JSON.stringify(task.approval,null,2);$('agentApproval').append(pre);button('批准本次操作',()=>agentTaskAction('approve'));button('拒绝本次操作',()=>agentTaskAction('decline'),'danger');}
 if(task.state==='needs_input'){const form=document.createElement('form');for(const q of task.approval?.questions||[]){const label=document.createElement('label'),input=document.createElement('textarea');label.className='field';label.textContent=q.question||q.header||q.id;input.name=q.id;input.required=true;input.maxLength=4000;label.append(input);form.append(label);}const submit=document.createElement('button');submit.textContent='提交答案';form.append(submit);form.onsubmit=e=>{e.preventDefault();const answers={};for(const [key,value] of new FormData(form))answers[key]={answers:[value]};agentTaskAction('answer',{answers});};$('agentApproval').append(form);}
 if(['completed','failed','cancelled','interrupted','delivery_unknown'].includes(task.state)&&task.threadId)button('继续此任务',()=>{const text=prompt('补充要求（会先核对已有结果，避免重复执行）');if(text?.trim())agentTaskAction('continue',{text,requestId:crypto.randomUUID()});});
 }catch(error){if(requested===token)$('agentTaskMessage').textContent=error.message;}}
$('credentialProvider').onchange=()=>{$('credentialKey').value='';credentialStatus();};
$('agentCredentialForm').onsubmit=async event=>{event.preventDefault();const key=$('credentialKey').value.trim();if(!key){$('credentialMessage').textContent='请填写新密钥，留空不会修改已有配置。';return;}$('saveCredential').disabled=true;try{await agentMutation({action:'credential',provider:$('credentialProvider').value,key});$('credentialKey').value='';await loadAgent(true);$('credentialMessage').textContent='已加密保存。当前仍使用 Codex 登录，尚未调用或验证该 API。';}catch(error){$('credentialMessage').textContent=error.message;}finally{$('saveCredential').disabled=false;}};
$('deleteCredential').onclick=async()=>{if(!confirm('清除这个供应商已保存的密钥？'))return;try{await agentMutation({action:'credential',provider:$('credentialProvider').value,key:''});$('credentialKey').value='';await loadAgent(true);$('credentialMessage').textContent='已清除。';}catch(error){$('credentialMessage').textContent=error.message;}};
setInterval(()=>{if(token&&currentPage().key==='agentTasks')loadAgent(true);},5000);

const openclawStatuses={ready:'接口与认证正常',offline:'连接器离线',unverified:'尚未连接／检测',unreachable:'无法连接，请检查地址、证书与网络',unauthorized:'Gateway Token／密码错误',forbidden:'Gateway 拒绝访问',endpoint_disabled:'Responses 接口未启用或版本不兼容',http_error:'接口返回异常'};
function renderOpenClawConnections(){
 $('openclawConnections').replaceChildren();const uid=$('agentChannelUser').value;
 for(const conn of agentData?.connections||[]){if(conn.user_id!==uid)continue;const box=document.createElement('div'),title=document.createElement('h4'),state=document.createElement('p'),test=document.createElement('button'),remove=document.createElement('button');box.className='card';title.textContent=conn.name+' · '+(conn.transport==='relay'?'家中／内网主动连接':'云端 HTTPS');state.textContent=(openclawStatuses[conn.status]||conn.status)+' · Agent '+conn.agent+(conn.seen?' · '+new Date(conn.seen*1000).toLocaleString():'');test.type=remove.type='button';test.className='secondary';remove.className='danger';test.textContent='检测连接';remove.textContent='删除连接';
 test.onclick=async()=>{test.disabled=true;try{const data=await agentMutation({action:'test_openclaw',userId:uid,connectionId:conn.id});$('openclawMessage').textContent=(data.ok?'检测通过：':'检测未通过：')+(openclawStatuses[data.status]||data.status)+'。此检测不会启动模型任务。';await loadAgent(true);}catch(e){$('openclawMessage').textContent=e.message;}finally{test.disabled=false;}};
 remove.onclick=async()=>{if(!confirm('删除此连接并撤销连接密钥？需要先解除频道绑定。'))return;try{await agentMutation({action:'delete_openclaw',userId:uid,connectionId:conn.id});await loadAgent(true);$('openclawMessage').textContent='连接已删除。';}catch(e){$('openclawMessage').textContent=e.message;}};
 box.append(title,state,test,remove);$('openclawConnections').append(box);}
}
function openclawTransport(){const direct=$('openclawTransport').value==='https';$('openclawDirect').hidden=!direct;$('openclawRelayHint').hidden=direct;$('openclawUrl').required=direct;$('openclawToken').required=direct;}
$('openclawTransport').onchange=openclawTransport;
$('openclawForm').oninput=()=>{connectionDirty=true;updateAgentDirty();};
$('openclawForm').onsubmit=async event=>{
 event.preventDefault();const uid=$('agentChannelUser').value;if(!uid){$('openclawMessage').textContent='请先选择用户；暂无用户时让设备连接一次。';return;}
 $('createOpenclaw').disabled=true;try{
 const data=await agentMutation({action:'connect_openclaw',userId:uid,name:$('openclawName').value.trim(),transport:$('openclawTransport').value,url:$('openclawUrl').value.trim(),agent:$('openclawAgent').value.trim(),token:$('openclawToken').value});
 $('openclawToken').value='';connectionDirty=false;updateAgentDirty();await loadAgent(true);
 if(uid!==$('agentChannelUser').value)return;
 fillAgentChannels(readAgentChannels());
 $('openclawPairing').hidden=!data.pairingToken;
 if(data.pairingToken){$('openclawPairToken').value=data.pairingToken;$('openclawCommand').textContent='python voxi-openclaw.py --server '+location.origin+' --connection '+data.connectionId;}
 $('openclawMessage').textContent=data.pairingToken?'连接已创建。按下方步骤在 OpenClaw 电脑启动连接器，再检测并绑定频道。':'连接已加密保存。请检测连接，通过后绑定到频道。';
 }catch(e){$('openclawMessage').textContent=e.message;}finally{$('createOpenclaw').disabled=false;}
};
$('copyOpenclawPair').onclick=async()=>{try{await navigator.clipboard.writeText($('openclawPairToken').value);$('openclawMessage').textContent='已复制连接密钥，请粘贴到本机连接器提示中。';}catch{$('openclawPairToken').type='text';$('openclawPairToken').select();$('openclawMessage').textContent='请手动复制选中的连接密钥。';}};
setInterval(()=>{if(token&&currentPage().key==='agent')loadAgent(true);},10000);

let userAccountsDirty=false;
async function loadUserAccounts(){const requested=token;try{const data=await api('users');if(requested!==token)return;const selected=$('newUserProfile').value;$('newUserProfile').replaceChildren();for(const u of data.profiles)if(!data.accounts.some(a=>a.userId===u.id))$('newUserProfile').append(option(u.id,u.name));$('newUserProfile').append(option('','新建用户档案'));if([...$('newUserProfile').options].some(o=>o.value===selected))$('newUserProfile').value=selected;userProfileChoice();$('userAccounts').replaceChildren();
 for(const a of data.accounts){const tr=document.createElement('tr');cell(tr,a.username+' · 普通用户');cell(tr,data.profiles.find(p=>p.id===a.userId)?.name||'档案已失效');cell(tr,a.enabled?'可登录':'已停用');const td=cell(tr,''),toggle=document.createElement('button');toggle.className='secondary';toggle.type='button';toggle.textContent=a.enabled?'停用账户':'启用账户';toggle.onclick=async()=>{try{await api('users',{action:'enabled',accountId:a.id,enabled:!a.enabled});await loadUserAccounts();$('userAccountsMessage').textContent='账户状态已保存，旧会话已撤销。';}catch(e){$('userAccountsMessage').textContent=e.message;}};td.append(toggle);
 const detail=document.createElement('details'),summary=document.createElement('summary'),form=document.createElement('form'),input=document.createElement('input'),button=document.createElement('button');summary.textContent='重置密码';input.type='password';input.autocomplete='new-password';input.placeholder='新密码（至少8字符）';input.setAttribute('aria-label','重置 '+a.username+' 的密码');input.minLength=8;input.maxLength=128;input.required=true;button.textContent='保存新密码';form.append(input,button);form.onsubmit=async e=>{e.preventDefault();try{await api('users',{action:'password',accountId:a.id,password:input.value});input.value='';detail.open=false;$('userAccountsMessage').textContent='密码已重置，此账户所有网页会话已退出。';}catch(e){$('userAccountsMessage').textContent=e.message;}};detail.append(summary,form);td.append(detail);$('userAccounts').append(tr);}
 if(!data.accounts.length){const tr=document.createElement('tr');cell(tr,'暂无普通账户。请绑定现有档案或新建档案。').colSpan=4;$('userAccounts').append(tr);}
 }catch(e){if(requested===token)$('userAccountsMessage').textContent=e.message;}}
function userProfileChoice(){const create=!$('newUserProfile').value;$('newUserNameField').hidden=!create;$('newUserName').required=create;}
$('newUserProfile').onchange=userProfileChoice;
$('createUserAccount').oninput=()=>{userAccountsDirty=true;};
$('reloadUserAccounts').onclick=loadUserAccounts;
$('createUserAccount').onsubmit=async e=>{e.preventDefault();$('saveUserAccount').disabled=true;try{await api('users',{action:'create',username:$('newUserUsername').value.trim(),password:$('newUserPassword').value,userId:$('newUserProfile').value,name:$('newUserName').value,role:'user'});$('newUserPassword').value='';userAccountsDirty=false;await loadUserAccounts();$('userAccountsMessage').textContent='普通账户已创建。用户可通过 /app 登录，请让用户首次登录后修改密码。';}catch(e){$('userAccountsMessage').textContent=e.message;}finally{$('saveUserAccount').disabled=false;}};

let adminVoicePlayer=null,adminVoiceRequest=0;
let voiceLibraryTimer=null,voiceMetadata=null,voiceDescriptionVoice='';
const voiceLanguageName=l=>l==='zh-CN'?'中文':'English';
function voiceSampleLabel(row){return row?.languages?.length?'样音：'+row.languages.map(voiceLanguageName).join(' / '):row?.state==='failed'?'样音未通过':'样音待核对';}
function voiceOptionLabel(v,row){return v.name+' · '+v.style+' · '+voiceSampleLabel(row);}
function fillVoiceCatalog(meta){
 voiceMetadata=meta;$('voiceChoice').replaceChildren();for(const v of meta?.options||[{id:'cove',name:'Cove',style:'风格待试听'}])$('voiceChoice').append(option(v.id,voiceOptionLabel(v,meta?.library?.voices?.find(r=>r.id===v.id))));
 $('voicePreviewText').textContent=meta?.previewText?'核对用文案（中文与英文分开生成）：'+meta.previewText:'请更新后端。';
 $('voiceLanguageNote').textContent=meta?.languageNote||'';$('previewVoice').disabled=!meta?.previewVersion;$('prepareVoiceLibrary').disabled=true;$('probeVoiceLibrary').disabled=meta?.previewVersion!==5;
 if(meta?.previewVersion===5&&currentPage().key==='voice')refreshVoiceLibrary();
}
function updateVoiceDetails(edit=true){
 const v=voiceMetadata?.options?.find(v=>v.id===$('voiceChoice').value);if(!v)return;
 const source={'official-summary':'风格为官方描述的中文概括；场景是使用建议','admin-listening-note':'管理员试听标注','unreviewed':'声线、音高与性别印象尚未试听标注'}[v.styleSource]||'';
 $('voiceStyleHint').textContent=v.name+' · '+v.style+'。'+source+(v.languageReference?'。官方语言方向参考：'+v.languageReference+'；不等于其他语言不可用。':'');
 if(edit){voiceDescriptionVoice=v.id;$('voiceStyleDescription').value=v.styleSource==='unreviewed'?'':v.style;$('voiceStyleUseCase').value=v.useCase||'';}
 const row=voiceMetadata?.library?.voices?.find(r=>r.id===v.id);
 for(const o of $('voicePreviewLanguage').options)if(o.value)o.disabled=!row?.languages?.includes(o.value);
 if($('voicePreviewLanguage').selectedOptions?.[0]?.disabled)$('voicePreviewLanguage').value='';
 const selected=$('voicePreviewLanguage').value,languages=selected?[selected]:row?.languages?.length?row.languages:Object.keys(voiceMetadata.previewScripts||{});$('voicePreviewText').textContent=(row?.languages?.length?'参考文案（允许自然改写）：':'参考脚本（尚未就绪）：')+languages.map(l=>voiceMetadata.previewScripts?.[l]||'').join(' ');
}
async function refreshVoiceLibrary(prepare=false,probe=false){
 clearTimeout(voiceLibraryTimer);const session=token;if(!session||currentPage().key!=='voice')return;
 try{
  const library=await api('voice-preview',{action:probe?'probe':prepare?'prepare':'status'});if(token!==session||currentPage().key!=='voice')return;
  if(voiceMetadata)voiceMetadata.library=library;
  for(const row of library.voices||[]){const o=[...$('voiceChoice').options].find(o=>o.value===row.id),v=voiceMetadata?.options?.find(v=>v.id===row.id);if(o&&v)o.textContent=voiceOptionLabel(v,row);}
  $('voiceLibraryStatus').textContent='Cove 验证：'+(library.probe?.ready||0)+' / 2；样音核对：'+library.samplesReady+' / '+library.samplesTotal+' 段已通过；'+library.ready+' / '+library.total+' 款中英均就绪'+(library.failed?'；'+library.failed+' 款有失败项':'')+(library.running?(library.waitingForCapacity?'；等待空闲语音资源':'；正在准备 '+(library.current||'')+' '+voiceLanguageName(library.currentLanguage)+(library.stage==='meaning'?' · 正在核对大意':'')):'；本轮准备已结束')+'。成功样音已持久保存。'+(library.blockedReason?'准备暂停：'+library.blockedReason+'，请处理后重试。':'');
  $('voiceLibraryFailures').replaceChildren();for(const row of library.voices||[])for(const sample of row.samples||[])if(sample.error){const li=document.createElement('li');li.textContent=row.id+' · '+voiceLanguageName(sample.language)+'：'+sample.error.message+'（'+sample.error.code+'）'+(sample.actualText?'；实际转写：'+sample.actualText:'');$('voiceLibraryFailures').append(li);}
  updateVoiceDetails(false);$('prepareVoiceLibrary').disabled=library.running||!library.probe?.passed;$('probeVoiceLibrary').disabled=library.running;
  if(library.running)voiceLibraryTimer=setTimeout(()=>refreshVoiceLibrary(),5000);
 }catch(e){if(token===session&&currentPage().key==='voice'){$('voiceLibraryStatus').textContent='音频库状态未确认：'+e.message;$('prepareVoiceLibrary').disabled=true;$('probeVoiceLibrary').disabled=false;}}
}
$('prepareVoiceLibrary').onclick=()=>refreshVoiceLibrary(true);
$('probeVoiceLibrary').onclick=()=>refreshVoiceLibrary(false,true);
$('voiceChoice').onchange=()=>{if(voiceDescriptionDirty&&!confirm('音色说明尚未保存，切换会丢弃，继续吗？')){$('voiceChoice').value=voiceDescriptionVoice;return;}voiceDescriptionDirty=false;adminVoiceRequest++;adminVoicePlayer?.stop();updateVoiceDetails();voiceDirty=true;};
$('voicePreviewLanguage').onchange=()=>{adminVoiceRequest++;adminVoicePlayer?.stop();updateVoiceDetails(false);};
$('saveVoiceDescription').onclick=async()=>{const voice=$('voiceChoice').value,session=token,style=$('voiceStyleDescription').value,useCase=$('voiceStyleUseCase').value;$('saveVoiceDescription').disabled=true;try{await api('voice-preview',{action:'describe',voice,style,useCase});if(session!==token)return;const latest=await api('ai');if(session!==token)return;voiceMetadata=latest.voices;for(const v of voiceMetadata.options){const o=[...$('voiceChoice').options].find(o=>o.value===v.id);if(o)o.textContent=voiceOptionLabel(v,voiceMetadata.library?.voices?.find(r=>r.id===v.id));}updateVoiceDetails(false);voiceDescriptionDirty=false;$('voiceDescriptionStatus').textContent='音色说明已保存。只更新展示说明，不会改变声音或设备当前音色。';}catch(e){$('voiceDescriptionStatus').textContent=e.message;}finally{$('saveVoiceDescription').disabled=false;}};
$('previewVoice').onclick=async()=>{const request=++adminVoiceRequest,session=token;try{const {createVoicePreview}=await import('/shared/voice-preview.js');if(request!==adminVoiceRequest||session!==token||currentPage().key!=='voice')return;adminVoicePlayer??=createVoicePreview({audio:$('voicePreviewAudio'),status:$('voicePreviewStatus'),caption:$('voicePreviewActualText'),request:(body,options)=>api('voice-preview',body,options)});await adminVoicePlayer.play($('voiceChoice').value,$('voicePreviewLanguage').value);}catch(e){if(session===token)$('voicePreviewStatus').textContent=e.message;}};
$('stopVoicePreview').onclick=()=>{adminVoiceRequest++;adminVoicePlayer?.stop();};
