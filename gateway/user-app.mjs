const $=id=>document.getElementById(id);let csrf='',account='',data=null,dirty=false,busy=false,detail=null,submitId=null,generation=0,reading=null;
const dirtyForms=new Set();
const pages=['profile','channels','connections','context','tasks','account'];
const states={queued:'等待执行',submitting:'正在提交',running:'执行中',needs_input:'需要补充信息',awaiting_approval:'等待确认',cancelling:'正在停止',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断',delivery_unknown:'结果未确认'};
const statuses={ready:'接口与认证正常',offline:'连接器离线',unverified:'尚未连接／检测',unreachable:'连接不可达，请检查网络、地址与证书',unauthorized:'Gateway 凭据错误',forbidden:'访问被拒绝',endpoint_disabled:'Responses 接口未启用或版本不兼容',http_error:'接口返回异常'};
function message(text){$('message').textContent=text;}
async function api(path,body,{timeoutMs=12000,signal}={}){const requestedGeneration=generation;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);const cancel=()=>controller.abort();if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});try{const response=await fetch('/api/user/'+path,{method:body?'POST':'GET',headers:{'X-CSRF-Token':csrf,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'same-origin',cache:'no-store',signal:controller.signal});let value;try{value=await response.json();}catch{throw Error('服务暂不可用，请联系管理员检查部署');}if(requestedGeneration!==generation)throw Error('会话已切换，请重新读取');if(!response.ok){if(response.status===401&&path!=='login'&&path!=='password')signedOut();throw Error(value.error||'请求未完成');}return value;}catch(e){if(e.name==='AbortError')throw Error('请求超时，请稍后重试');throw e;}finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}}
const option=(v,t)=>{const node=document.createElement('option');node.value=v;node.textContent=t;return node;};
function button(label,action,cls='secondary'){const node=document.createElement('button');node.type='button';node.textContent=label;node.className=cls;node.onclick=action;return node;}
function signedOut(){clearContext();userVoiceRequest++;userVoicePlayer?.stop(null);channelPlayer?.stop(null);generation++;csrf='';data=null;detail=null;resetModelForm();$('modelProvider').replaceChildren();$('modelConnections').replaceChildren();dirty=false;dirtyForms.clear();$('workspace').hidden=true;$('login').hidden=false;$('logout').hidden=true;$('identity').textContent='';for(const id of ['password','connectionToken','pairToken','currentPassword','newPassword','profileName','profileText','fastPrompt','connectionName','connectionUrl','myVoice'])$(id).value='';$('pairing').hidden=true;$('myMemoryPanel').open=false;for(const id of ['webTaskMemory','tasks','connections','devices','memories','turns','channels','taskChannel','taskActions','approval'])$(id).replaceChildren();$('detailState').textContent='';$('detailTitle').textContent='';$('memoryEnabled').checked=false;$('detailPrompt').textContent='';$('detailResult').textContent='';$('taskText').value='';$('taskDetail').hidden=true;}
function page(){const tail=location.pathname.replace(/\/$/,'').split('/').pop();return pages.includes(tail)?tail:'profile';}
function showPage(){if(!csrf)return;const key=page();if(key!=='context')clearContext();for(const p of pages){$(p+'Page').hidden=p!==key;const link=document.querySelector('[data-page="'+p+'"]');if(p===key)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}document.title=({profile:'我的资料',channels:'频道与助手',connections:'接入管理',context:'上下文同步',tasks:'我的任务',account:'账户安全'}[key])+' · Voxi';}
function navigate(path){if(dirty&&!confirm('有未保存的设置，离开会丢弃，继续吗？'))return;if(page()==='connections'){ $('pairToken').value='';$('pairing').hidden=true;$('connectionToken').value='';resetModelForm();}dirty=false;dirtyForms.clear();userVoiceRequest++;userVoicePlayer?.stop(null);channelPlayer?.stop(null);history.pushState({},'',path);showPage();if(data)render(true);message('');}
document.addEventListener('click',e=>{const link=e.target.closest?.('a[href^="/app"]');if(!link||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button>0)return;e.preventDefault();navigate(new URL(link.href,location.origin).pathname);});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('popstate',()=>{if(dirty&&!confirm('有未保存的修改，继续离开吗？')){history.forward();return;}resetModelForm();dirty=false;dirtyForms.clear();userVoiceRequest++;userVoicePlayer?.stop(null);channelPlayer?.stop(null);showPage();if(data)render(true);});
const channelSlot=(channel,index)=>channel.slot??index;
const targetFor=channel=>['model','openclaw','muse'].includes(channel.mode)?channel.mode+':'+channel.connectionId:channel.mode;
function readTarget(value){const [mode,connectionId]=value.split(':');return connectionId?{mode,connectionId}:{mode};}
function channelEdited(){dirtyForms.add('channelForm');dirty=true;}
function channelPersonalization(card,channel,target,catalog){
 const settings=document.createElement('details'),summary=document.createElement('summary');
 const label=document.createElement('label'),role=document.createElement('textarea'),hint=document.createElement('p');
 const tools=document.createElement('div');
 settings.className='channel-personalization';settings.append(summary,label,hint,tools);
 role.rows=3;role.maxLength=catalog.roleLimit;role.value=channel.role||'';
 role.dataset.channelRole='';label.append(document.createTextNode('角色与偏好'),role);
 hint.className='muted';
 for(const [field,title,items] of [['skills','Skill · 工作流程',catalog.skills],['mcp','MCP · 外部工具',catalog.mcp]]){
  const group=document.createElement('fieldset'),legend=document.createElement('legend');
  legend.textContent=title;group.append(legend);
  for(const item of items){
   const optionLabel=document.createElement('label'),check=document.createElement('input'),text=document.createElement('span');
   const description=document.createElement('small');
   optionLabel.className='channel-tool';check.type='checkbox';check.value=item.id;
   check.dataset.channelTool=field;check.checked=Boolean(channel[field]?.includes(item.id));
   text.textContent=item.name;description.textContent=item.description;text.append(description);
   optionLabel.append(check,text);group.append(optionLabel);
  }
  tools.append(group);
 }
 function update(){
  const agent=target.value==='agent';
  settings.hidden=!agent&&target.value!=='fast';tools.hidden=!agent;
  summary.textContent=agent?'角色、Skill 与 MCP':'角色配置';
  role.placeholder=agent?'例如：担任项目助理，先查证再给结论，交付时列出已验证的结果。':'例如：像技术教练一样解释问题，先给结论，再举一个例子。';
  hint.textContent=agent?'仅用于此频道的新任务或下一轮。Skill 提供工作步骤，MCP 提供外部工具。修改 MCP 后请发起新任务。':'仅用于此快问频道。留空则沿用快问通用偏好与系统默认设置。';
 }
 target.addEventListener('change',update);update();card.append(settings);
}
function renderChannels(channels=data.channels){
 const box=$('channels'),limit=data.channelLimit;
 box.replaceChildren();
 channels.forEach((c,i)=>{
  const slot=channelSlot(c,i),card=document.createElement('div'),label=document.createElement('label');
  const name=document.createElement('input'),target=document.createElement('select');
  card.className='channel';card.dataset.slot=slot;label.textContent='CH'+slot;
  name.id='channelName'+slot;label.htmlFor=name.id;name.value=c.name;name.maxLength=32;name.required=true;
  target.id='channelTarget'+slot;target.setAttribute('aria-label','CH'+slot+' 助手');
  target.append(option('fast','快问 · 即问即答'),option('agent','Voxi Agent · 后台执行'),option('disabled','停用'));
  const value=targetFor(c);
  for(const conn of data.connections){
   const mode=conn.engine||'openclaw',key=mode+':'+conn.id;
   if(conn.status==='ready'||value===key)target.append(option(key,conn.name+' · '+agentLabel(mode)));
  }
  for(const conn of data.modelConnections||[])target.append(option('model:'+conn.id,conn.name+' · '+conn.model));
  if(![...target.options].some(o=>o.value===value))target.append(option(value,'连接已失效，请重新选择'));
  target.value=value;card.append(label,name,target);
  if(data.capabilities?.channelVoices){
   const voiceLabel=document.createElement('label'),voice=document.createElement('select');
   voice.id='channelVoice'+slot;voiceLabel.htmlFor=voice.id;voiceLabel.textContent='播报音色';
   voice.append(option('','跟随个人／系统音色'));
   for(const v of data.voiceSettings?.options||[])voice.append(option(v.id,myVoiceLabel(v,myVoiceRow(data.voiceSettings,v.id))));
   voice.value=c.voice||'';card.append(voiceLabel,voice,button('试听',()=>previewChannelVoice(voice.value)));
  }
  if(data.channelTools)channelPersonalization(card,c,target,data.channelTools);
  if(limit)card.append(button('移除 CH'+slot,()=>{channelEdited();renderChannels(readChannels().filter(row=>row.slot!==slot));},'danger'));
  box.append(card);
 });
 if(!channels.length)box.textContent='还没有频道。添加后保存，即可在设备上切换。';
 $('addChannel').hidden=!limit;$('addChannel').disabled=channels.length>=limit;
 $('channelSource').textContent=data.inheritsChannels?'当前使用默认频道。修改并保存后，只应用到你的设备。':'当前使用你的个人频道。';
 if(limit)$('channelSource').textContent+=' 最多 '+limit+' 个频道。';
 $('restoreChannels').hidden=data.inheritsChannels;
}
function readChannels(){
 return [...$('channels').querySelectorAll('[data-slot]')].map(card=>{
  const slot=Number(card.dataset.slot);
  const target=readTarget($('channelTarget'+slot).value);
  const route={...(data.channelLimit?{slot}:{}),name:$('channelName'+slot).value.trim(),...target,
   ...($('channelVoice'+slot)?.value?{voice:$('channelVoice'+slot).value}:{})};
  if(['fast','agent'].includes(target.mode)){
   const role=card.querySelector('[data-channel-role]')?.value.trim();
   if(role)route.role=role;
  }
  if(target.mode==='agent'){
   for(const field of ['skills','mcp']){
    const ids=[...card.querySelectorAll('[data-channel-tool="'+field+'"]:checked')].map(input=>input.value);
    if(ids.length)route[field]=ids;
   }
  }
  return route;
 });
}
$('addChannel').onclick=()=>{
 const channels=readChannels(),occupied=new Set(channels.map(row=>row.slot));
 const slot=Array.from({length:data.channelLimit},(_,i)=>i).find(i=>!occupied.has(i));
 if(slot===undefined)return;
 channelEdited();renderChannels([...channels,{slot,name:'频道 '+slot,mode:'disabled'}].sort((a,b)=>a.slot-b.slot));
 $('channelName'+slot).focus();
};
function renderDevices(){ $('devices').replaceChildren();for(const d of data.devices){const box=document.createElement('div'),text=document.createElement('p');box.className='item';text.textContent=(d.name||'我的设备')+' · '+d.id;box.append(text,button('修改名称',async()=>{const name=prompt('设备名称',d.name||'');if(name?.trim())await change({action:'rename_device',deviceId:d.id,name});}));$('devices').append(box);}if(!data.devices.length)$('devices').textContent='暂无绑定设备，请联系管理员绑定。';for(const [id,items] of [['memories',data.memories],['turns',data.turns.slice(0,20)]]){$(id).replaceChildren();for(const item of items){const p=document.createElement('p');p.textContent=item.text;$(id).append(p);}}}
let webMemoryRead=0;
async function loadOwnWebMemory(){
 if(!$('myMemoryPanel').open)return;
 const run=generation,read=++webMemoryRead,container=$('webTaskMemory');
 const current=()=>run===generation&&read===webMemoryRead&&Boolean(csrf)&&page()==='profile';
 if(!current())return;
 try{
  const {mountWebMemory}=await import('/shared/web-memory.js');
  await mountWebMemory(container,body=>api('web-memory',body),current,value=>{
   if(value)dirtyForms.add('webMemory');else dirtyForms.delete('webMemory');
   dirty=dirtyForms.size>0;
  });
 }catch(e){if(current())container.textContent=e.message;}
}
$('myMemoryPanel').ontoggle=()=>{
 if($('myMemoryPanel').open&&!dirtyForms.has('webMemory'))void loadOwnWebMemory();
};
const agentLabel=engine=>engine==='muse'?'Muse Code':'OpenClaw';
const externalAgent=engine=>['openclaw','muse'].includes(engine);
function renderConnections(){$('connections').replaceChildren();for(const conn of data.connections){const box=document.createElement('div'),title=document.createElement('h3'),status=document.createElement('p');box.className='item';title.textContent=conn.name+' · '+agentLabel(conn.engine);status.textContent=(conn.transport==='https'?'HTTPS 直连':'主动连接')+' · '+(conn.engine==='muse'&&conn.status==='ready'?'Muse Code 已在线':statuses[conn.status]||conn.status)+(conn.engine==='muse'?'':' · Agent '+conn.agent);box.append(title,status,button('检测连接',async()=>{try{const result=await api('action',{action:'test_openclaw',connectionId:conn.id});const status=conn.engine==='muse'&&result.ok?'Muse Code 连接器在线':statuses[result.status]||result.status;message((result.ok?'检测通过：':'检测未通过：')+status+'。没有运行模型任务。');await load(false);}catch(e){message(e.message);}}),button('删除连接',async()=>{if(confirm('先解除频道绑定，再删除此连接；删除会撤销连接密钥。'))await change({action:'delete_openclaw',connectionId:conn.id});},'danger'));$('connections').append(box);}}
let editingModel=null;
function providerOption(provider){
 const group=provider.category==='app'?'应用':provider.category==='aggregator'?'模型聚合':'直连模型';
 return group+' / '+provider.name;
}
function modelFields(fill=false){
 const provider=data?.modelProviders?.[$('modelProvider').value];
 if(!provider)return;
 const app=provider?.category==='app';
 $('modelIdField').hidden=Boolean(provider?.fixedModel);
 $('modelId').required=!provider?.fixedModel;
 $('modelIdLabel').textContent=provider?.modelLabel||'模型 ID';
 $('modelWorkspaceLabel').textContent=provider?.workspaceLabel||'百炼北京业务空间 ID';
 $('modelKeyLabel').textContent=app?'应用 API Key':'平台 API Key';
 $('modelHint').textContent=app
  ?'使用已发布的 Dify Cloud 应用密钥。验证只检查应用和输入设置。'+(provider.continuation?'已完成的对话可从任务详情继续。':'请配置一个文本输入和文本输出。')
  :'使用服务商 API 账户。验证会发送一次短文本请求，费用计入该账户。';
 $('modelWorkspaceField').hidden=!provider.workspaceRequired;
 $('modelWorkspace').required=provider.workspaceRequired;
 $('modelDocs').href=provider.docs;
 if(fill){$('modelId').value=provider.defaultModel||'';$('modelWorkspace').value=provider.defaultWorkspace||'';$('modelName').value=provider.name;}
}
function resetModelForm(){
 editingModel=null;
 $('modelForm').reset();
 $('modelProvider').disabled=$('modelId').readOnly=$('modelWorkspace').readOnly=false;
 $('modelKey').required=true;$('modelKey').placeholder='';
 $('cancelModelEdit').hidden=true;$('saveModel').textContent='验证并接入';
 if(data){$('modelProvider').selectedIndex=0;modelFields(true);}
}
function renderModelConnections(){
 const providers=data.modelProviders;
 $('modelSetup').hidden=!providers;
 if(!providers)return;
 const select=$('modelProvider');
 if(!select.options.length){
  for(const [id,provider] of Object.entries(providers))select.append(option(id,providerOption(provider)));
  modelFields(true);
 }
 const list=$('modelConnections');list.replaceChildren();
 for(const conn of data.modelConnections){
  const card=document.createElement('div'),title=document.createElement('h3'),description=document.createElement('p');
  card.className='item';title.textContent=conn.name;description.textContent=(providers[conn.provider]?.name||conn.provider)+' · '+(providers[conn.provider]?.fixedModel?'凭据已验证':conn.model+' · 已验证');
  card.append(title,description,
   button('检测连接',async()=>{
    if(busy)return;
    busy=true;
    try{await api('action',{action:'test_model',connectionId:conn.id});message('接入验证通过。');}
    catch(e){message(e.message);}finally{busy=false;}
   }),
   button('编辑名称或密钥',()=>{
    editingModel=conn.id;select.value=conn.provider;select.disabled=true;modelFields();
    $('modelName').value=conn.name;$('modelId').value=conn.model;$('modelWorkspace').value=conn.workspace;
    $('modelId').readOnly=$('modelWorkspace').readOnly=true;
    $('modelKey').value='';$('modelKey').required=false;$('modelKey').placeholder='留空保留现有密钥';
    $('cancelModelEdit').hidden=false;$('saveModel').textContent='验证并保存';
    $('modelName').focus();
   }),
   button('删除连接',()=>{if(confirm('删除该接入？请先解除频道绑定。'))change({action:'delete_model',connectionId:conn.id});},'danger'));
  list.append(card);
 }
}
$('modelProvider').onchange=()=>modelFields(true);
$('cancelModelEdit').onclick=()=>{resetModelForm();dirtyForms.delete('modelForm');dirty=dirtyForms.size>0;};
$('modelForm').onsubmit=async event=>{
 event.preventDefault();if(busy)return;
 busy=true;const run=generation;$('saveModel').disabled=true;
 try{
  await api('action',{action:'connect_model',connectionId:editingModel,provider:$('modelProvider').value,
   name:$('modelName').value.trim(),model:$('modelId').value.trim(),workspace:$('modelWorkspace').value.trim(),key:$('modelKey').value.trim()});
  if(run!==generation)return;
  resetModelForm();dirtyForms.delete('modelForm');dirty=dirtyForms.size>0;await load(false);
  if(run===generation)message('接入已通过验证，可在「频道与助手」选择。');
 }catch(e){if(run===generation)message(e.message);}
 finally{busy=false;$('saveModel').disabled=false;}
};
function renderTasks(){$('tasks').replaceChildren();for(const task of data.tasks){const box=document.createElement('div'),title=document.createElement('h3'),summary=document.createElement('p');box.className='item';title.textContent='CH'+task.channel+' · '+(states[task.state]||task.state);summary.textContent=task.summary;box.append(title,summary,button('查看详情',()=>openTask(task.id)));$('tasks').append(box);}if(!data.tasks.length)$('tasks').textContent='还没有任务。可以从这里提交，或从设备的 Agent 频道派发。';const selected=$('taskChannel').value;$('taskChannel').replaceChildren();data.channels.forEach((c,i)=>{if(['agent','openclaw','muse','model'].includes(c.mode)){const slot=channelSlot(c,i);$('taskChannel').append(option(String(slot),'CH'+slot+' · '+c.name));}});if([...$('taskChannel').options].some(o=>o.value===selected))$('taskChannel').value=selected;$('submitTask').disabled=!data.serviceEnabled||!$('taskChannel').options.length;}
function render(edit=false){$('museOption').disabled=!data.capabilities?.museCode;transport();if(data)updateMyVoiceDetails();renderTokenUsage();if(edit&&page()==='context')void loadContext();$('serviceNotice').hidden=data.serviceEnabled;if(edit){renderVoiceSettings();$('profileName').value=data.profile.name;$('profileText').value=data.profile.profile;$('memoryEnabled').checked=Boolean(data.profile.enabled);$('fastPrompt').value=data.preferences.fastPrompt;renderChannels();renderDevices();if(page()==='profile'&&$('myMemoryPanel').open)void loadOwnWebMemory();}renderConnections();renderModelConnections();renderTasks();}
async function load(edit=false){if(reading){await reading;return load(edit);}const expected=csrf,run=generation;let finish;reading=new Promise(r=>finish=r);try{const state=await api('state');if(expected!==csrf||run!==generation)return;if(!state.profile||state.role!=='user')throw Error('用户服务未更新，请联系管理员');data=state;render(edit);if(detail&&page()==='tasks')await openTask(detail.id,true);}catch(e){if(expected===csrf)message(e.message);}finally{reading=null;finish();}}
async function change(body){if(busy)return;busy=true;const run=generation;try{await api('action',body);if(run!==generation)return;const form={profile:'profileForm',preferences:'preferenceForm',voice_preference:'voiceForm',channels:'channelForm',reset_channels:'channelForm'}[body.action];if(form)dirtyForms.delete(form);dirty=dirtyForms.size>0;await load(false);if(run!==generation||!data)return;if(['channels','reset_channels'].includes(body.action))renderChannels();if(body.action==='rename_device')renderDevices();if(body.action==='profile'){$('profileName').value=data.profile.name;$('profileText').value=data.profile.profile;$('memoryEnabled').checked=Boolean(data.profile.enabled);}if(body.action==='voice_preference'){userVoicePlayer?.stop(null);channelPlayer?.stop(null);renderVoiceSettings();$('myVoiceStatus').textContent='个人音色已保存。设备重连或切换频道生效。';}if(body.action==='preferences')$('fastPrompt').value=data.preferences.fastPrompt;message('已保存。');}catch(e){if(run===generation)message(e.message);}finally{busy=false;}}
$('logout').onclick=async()=>{try{await api('logout',{});signedOut();message('已退出。');}catch(e){message(e.message);}};
for(const id of ['profileForm','preferenceForm','voiceForm','channelForm','connectionForm','modelForm'])$(id).oninput=e=>{if(id==='voiceForm'&&e?.target?.id==='myVoiceLanguage')return;dirtyForms.add(id);dirty=true;};
$('profileForm').onsubmit=e=>{e.preventDefault();change({action:'profile',name:$('profileName').value,profile:$('profileText').value,enabled:$('memoryEnabled').checked});};
$('preferenceForm').onsubmit=e=>{e.preventDefault();change({action:'preferences',preferences:{fastPrompt:$('fastPrompt').value}});};
$('channelForm').onsubmit=e=>{e.preventDefault();change({action:'channels',channels:readChannels()});};
$('restoreChannels').onclick=()=>{if(confirm('恢复默认频道？现有个人频道设置会被替换。'))change({action:'reset_channels'});};
function transport(){const muse=$('connectionEngine').value==='muse';const direct=!muse&&$('connectionTransport').value==='https';$('openClawFields').hidden=muse;$('connectionAgent').required=!muse;$('museHint').hidden=!muse;$('directFields').hidden=!direct;$('relayHint').hidden=direct;$('connectionUrl').required=direct;$('connectionToken').required=direct;}
$('connectionTransport').onchange=transport;
$('connectionEngine').onchange=()=>{transport();$('pairToken').value='';$('pairing').hidden=true;};
$('connectionForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;const run=generation;$('createConnection').disabled=true;try{const muse=$('connectionEngine').value==='muse',name=$('connectionName').value.trim();const result=await api('action',muse?{action:'connect_muse',name}:{action:'connect_openclaw',name,transport:$('connectionTransport').value,url:$('connectionUrl').value.trim(),agent:$('connectionAgent').value.trim(),token:$('connectionToken').value});if(run!==generation)return;$('connectionToken').value='';dirtyForms.delete('connectionForm');dirty=dirtyForms.size>0;await load(false);if(run!==generation)return;$('pairing').hidden=!result.pairingToken;if(result.pairingToken){$('pairToken').type='password';$('pairToken').value=result.pairingToken;$('openClawPairing').hidden=muse;$('musePairing').hidden=!muse;$('pairingAuthHint').textContent=muse?'按提示输入 Voxi 配对密钥。主机沿用本机的 Muse Code 登录与权限规则，连接器会拒绝未授权的操作。':'按提示输入连接密钥和本机 Gateway Token。';$('connectorCommand').textContent=(muse?'node voxi-muse-code.mjs':'python voxi-openclaw.py')+' --server '+location.origin+' --connection '+result.connectionId+(muse?' --workspace "项目目录路径"':'');}message('连接已创建。检测通过后，到「频道与助手」选择并保存。');}catch(e){message(e.message);}finally{busy=false;$('createConnection').disabled=false;}};
$('copyPair').onclick=async()=>{try{await navigator.clipboard.writeText($('pairToken').value);message('连接密钥已复制。');}catch{$('pairToken').type='text';$('pairToken').select();message('请手动复制选中的密钥。');}};
$('taskForm').oninput=()=>{submitId=null;};
$('taskForm').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('submitTask').disabled=true;try{submitId||=crypto.randomUUID();const result=await api('action',{action:'submit',channel:Number($('taskChannel').value),requestId:submitId,text:$('taskText').value});submitId=null;$('taskText').value='';await load(false);await openTask(result.task.id);message('任务已保存，无需保持网页在线。'+(result.webMemoryUsed?.length?' 已带入参考记忆 '+result.webMemoryUsed.join('、')+'。':''));}catch(e){message(e.message+'。内容不变时重试使用同一编号，避免重复派发。');}finally{busy=false;if(data)renderTasks();}};
async function taskAction(action,extra={}){if(!detail)return;try{const result=await api('action',{action,taskId:detail.id,...extra});await load(false);await openTask(result.task.id);message('操作已提交。');}catch(e){message(e.message);}}
async function openTask(id,poll=false){const expected=csrf;try{const result=await api('action',{action:'detail',taskId:id});if(expected!==csrf)return;detail=result.task;$('taskDetail').hidden=false;$('detailTitle').textContent='任务 '+id.slice(0,8);$('detailState').textContent=(states[detail.state]||detail.state)+' · '+detail.summary;$('detailPrompt').textContent=detail.prompt;$('detailResult').textContent=detail.result||'尚无最终回复。';if(poll&&$('approval').contains(document.activeElement))return;$('approval').replaceChildren();$('taskActions').replaceChildren();if(['queued','running','awaiting_approval','needs_input'].includes(detail.state)||(externalAgent(detail.engine)&&detail.state==='submitting'))$('taskActions').append(button(['openclaw','model'].includes(detail.engine)?'停止等待':'取消任务',()=>{if(confirm(detail.engine==='muse'?'向 Muse Code 请求停止？已产生的修改不会撤销。':detail.engine==='openclaw'?'停止等待后，请在 OpenClaw 核对或停止远端任务。继续吗？':detail.engine==='model'?'停止等待后，服务端可能仍在执行并计费。继续吗？':'请求停止此任务？已经产生的修改不会自动撤销。'))taskAction('cancel');},'danger'));
 if(detail.state==='awaiting_approval'){const pre=document.createElement('pre');pre.textContent=JSON.stringify(detail.approval,null,2);$('approval').append(pre);$('taskActions').append(button('批准本次操作',()=>taskAction('approve')),button('拒绝操作',()=>taskAction('decline'),'danger'));}
 if(detail.state==='needs_input'){const form=document.createElement('form');for(const q of detail.approval?.questions||[]){const label=document.createElement('label'),input=document.createElement('textarea');label.textContent=q.question||q.header||q.id;input.name=q.id;input.required=true;input.maxLength=4000;label.append(input);form.append(label);}const b=document.createElement('button');b.textContent='提交答案';form.append(b);form.onsubmit=e=>{e.preventDefault();const answers={};for(const [key,value] of new FormData(form))answers[key]={answers:[value]};taskAction('answer',{answers});};$('approval').append(form);}
 if(['completed','failed','interrupted','cancelled','delivery_unknown'].includes(detail.state)&&detail.threadId)$('taskActions').append(button('继续此任务',()=>{const text=prompt('补充要求；助手会先核对已有结果');if(text?.trim())taskAction('continue',{text,requestId:crypto.randomUUID()});}));
 }catch(e){message(e.message);}}
$('passwordForm').onsubmit=async e=>{e.preventDefault();try{await api('password',{currentPassword:$('currentPassword').value,newPassword:$('newPassword').value});signedOut();message('密码已修改，请重新登录。');}catch(e){message(e.message);}};
setInterval(()=>{if(csrf&&!dirty&&['tasks','connections','account'].includes(page()))load(false);},5000);
let contextMount=0,channelPlayer=null;
function clearContext(){
 contextMount++;
 for(const id of ['contextToken','contextFile','contextConnectorName'])$(id).value='';
 for(const id of ['contextChats','contextConnections','contextDetailTitle','contextDetailText','contextImportPreview','contextStatus','contextCommand'])$(id).replaceChildren();
 $('contextPairing').hidden=$('contextDetail').hidden=true;$('contextImport').disabled=true;
}
async function loadContext(){
 clearContext();
 const run=contextMount,session=generation;
 const current=()=>run===contextMount&&session===generation&&page()==='context'&&Boolean(csrf);
 if(!data.capabilities?.contextSync){$('contextStatus').textContent='上下文同步需要更新 Pocket Cloud。';return;}
 try{const {mountContext}=await import('/app/assets/context.js');if(current())mountContext($('contextPage'),api,current);}
 catch(e){if(current())$('contextStatus').textContent=e.message;}
}
async function previewChannelVoice(voice){
 const run=generation,request=++userVoiceRequest;
 try{
  const {createVoicePreview}=await import('/shared/voice-preview.js');
  if(run!==generation||request!==userVoiceRequest||page()!=='channels')return;
  channelPlayer??=createVoicePreview({audio:$('channelVoiceAudio'),status:$('channelVoiceStatus'),caption:$('channelVoiceCaption'),request:(body,options)=>api('voice-preview',body,options)});
  await channelPlayer.play(voice||data.voiceSettings.effectiveVoice,'');
 }catch(e){if(run===generation)$('channelVoiceStatus').textContent=e.message;}
}
function renderTokenUsage(){
 const box=$('myTokenUsage'),usage=data?.usage;box.replaceChildren();
 if(!usage){box.textContent='用量暂不可读取。';return;}
 const summary=document.createElement('p');summary.textContent=usage.totalTokens===null?'暂无可计量的 Token':usage.totalTokens.toLocaleString()+' Token';
 const coverage=document.createElement('p');coverage.className='muted';coverage.textContent='已计量 '+usage.measuredTasks+' / '+usage.tasks+' 个后台任务。语音仅统计回传用量的回复。';
 box.append(summary,coverage);
 for(const row of usage.engines){
  const item=document.createElement('p');
  item.textContent=({codex:'Voxi Agent',model:'模型频道',openclaw:'OpenClaw',muse:'Muse Code'}[row.engine]||row.engine)+' · '+(row.totalTokens===null?'未回传':row.totalTokens.toLocaleString()+' Token');
  box.append(item);
 }
 for(const row of usage.voice||[]){
  const item=document.createElement('p');
  item.textContent=(row.kind==='fast'?'快问语音':'任务播报')+' · '+row.totalTokens.toLocaleString()+' Token · '+row.responses+' 条已计量回复';
  box.append(item);
 }
}
async function restore(){const run=generation;try{const user=await api('session');csrf=user.csrf;account=user.username;$('identity').textContent=account+' · 普通用户';$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;showPage();await load(true);}catch{if(run===generation)signedOut();}}
restore();

let userVoicePlayer=null,userVoiceRequest=0;
function myVoiceRow(meta,id){return meta?.library?.voices?.find(r=>r.id===id);}
function myVoiceLabel(v,row){const languages=row?.languages?.map(l=>l==='zh-CN'?'中文':'English')||[];return v.name+' · '+v.style+' · '+(languages.length?'样音：'+languages.join(' / '):'样音待核对');}
function updateMyVoiceDetails(){
 const meta=data?.voiceSettings;if(!meta)return;const id=$('myVoice').value||meta.defaultVoice,v=meta.options?.find(v=>v.id===id),row=myVoiceRow(meta,id);
 for(const v of meta.options||[]){const o=[...$('myVoice').options].find(o=>o.value===v.id);if(o)o.textContent=myVoiceLabel(v,myVoiceRow(meta,v.id));}
 $('myVoiceStyle').textContent=v?v.style+(v.useCase?' · 建议用于：'+v.useCase:'')+(v.languageReference?' · 官方语言方向参考：'+v.languageReference:'')+(v.styleSource==='admin-listening-note'?' · 管理员试听标注':v.styleSource==='official-summary'?' · 官方风格概括，场景为建议':' · 具体声线待试听标注'):'';
 $('myVoiceErrors').textContent=(row?.samples||[]).filter(s=>s.error).map(s=>(s.language==='zh-CN'?'中文':'English')+'：'+s.error.message).join('；')+(meta.library?.blockedReason?'；样音准备暂停：'+meta.library.blockedReason:'');
 for(const o of $('myVoiceLanguage').options)if(o.value)o.disabled=!row?.languages?.includes(o.value);
 if($('myVoiceLanguage').selectedOptions?.[0]?.disabled)$('myVoiceLanguage').value='';
 const selected=$('myVoiceLanguage').value,languages=selected?[selected]:row?.languages?.length?row.languages:Object.keys(meta.previewScripts||{});$('myVoiceText').textContent=(row?.languages?.length?'参考文案（允许自然改写）：':'参考脚本（尚未就绪）：')+languages.map(l=>meta.previewScripts?.[l]||'').join(' ');
}
function renderVoiceSettings(){const meta=data.voiceSettings;$('myVoice').replaceChildren();$('myVoice').append(option('','跟随服务默认（'+(meta?.defaultVoice||'Cove')+'）'));for(const v of meta?.options||[])$('myVoice').append(option(v.id,myVoiceLabel(v,myVoiceRow(meta,v.id))));$('myVoice').value=data.preferences.voice||'';$('myVoiceSource').textContent=meta?'当前生效音色：'+meta.effectiveVoice+(meta.selectedVoice?' · 个人设置':' · 跟随服务默认'):'音色功能需要管理员升级后端。';$('myVoiceText').textContent=meta?'参考文案（允许自然改写）：'+meta.previewText+' '+(meta.languageNote||''):'';$('previewMyVoice').disabled=$('saveMyVoice').disabled=meta?.previewVersion!==5;updateMyVoiceDetails();}
$('myVoice').onchange=()=>{userVoiceRequest++;userVoicePlayer?.stop();updateMyVoiceDetails();};
$('myVoiceLanguage').onchange=()=>{userVoiceRequest++;userVoicePlayer?.stop();updateMyVoiceDetails();};
$('voiceForm').onsubmit=e=>{e.preventDefault();change({action:'voice_preference',voice:$('myVoice').value});};
$('previewMyVoice').onclick=async()=>{const run=generation,request=++userVoiceRequest;try{const {createVoicePreview}=await import('/shared/voice-preview.js');if(run!==generation||request!==userVoiceRequest||page()!=='profile')return;userVoicePlayer??=createVoicePreview({audio:$('myVoiceAudio'),status:$('myVoiceStatus'),caption:$('myVoiceActualText'),request:(body,options)=>api('voice-preview',body,options)});await userVoicePlayer.play($('myVoice').value,$('myVoiceLanguage').value);}catch(e){if(run===generation)$('myVoiceStatus').textContent=e.message;}};
$('stopMyVoice').onclick=()=>{userVoiceRequest++;userVoicePlayer?.stop();};
