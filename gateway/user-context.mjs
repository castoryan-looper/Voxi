const sources={codex:'Codex','claude-code':'Claude Code',claude:'Claude 网页／桌面版',
 'open-webui':'Open WebUI（含 Ollama）',ollama:'Ollama 消息 JSON'};
const array=value=>Array.isArray(value)?value:[];
const message=(role,text)=>({role,text:typeof text==='string'?text.trim().slice(0,1600):''});
function content(value){
 if(typeof value==='string')return value;
 return array(value).filter(block=>['text','input_text','output_text'].includes(block?.type))
  .map(block=>block.text||'').join('\n');
}
function timestamp(value){
 const n=typeof value==='number'?(value<1e11?value*1000:value):Date.parse(value);
 return Number.isFinite(n)&&n>0?Math.min(Date.now(),Math.round(n)):Date.now();
}
async function stableId(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return 'file-'+[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function jsonLines(text,source){
 const lines=text.trim().split(/\r?\n/).map(line=>JSON.parse(line));
 if(source==='codex'){
  const meta=lines.find(row=>row.type==='session_meta')?.payload;
  return [{id:meta?.id,updated_at:lines.at(-1)?.timestamp,messages:lines.filter(row=>
   row.type==='response_item'&&row.payload?.type==='message').map(row=>row.payload)}];
 }
 if(source==='claude-code'){
  const rows=lines.filter(row=>!row.isSidechain&&!row.isMeta&&!row.isCompactSummary&&['user','assistant'].includes(row.type));
  return [{id:rows[0]?.sessionId,updated_at:rows.at(-1)?.timestamp,messages:rows.map(row=>row.message)}];
 }
 throw Error('JSONL 仅用于 Codex 和 Claude Code');
}
function webuiHistory(chat){
 const history=chat.history;
 if(!history?.currentId||!history.messages)return array(chat.messages);
 const recent=[], seen=new Set();
 let id=history.currentId;
 while(id&&!seen.has(id)&&recent.length<64){
  seen.add(id);const item=history.messages[id];if(!item)break;
  recent.push(item);id=item.parentId;
 }
 return recent.reverse();
}
export async function parseContextFile(text,source,fileName){
 let raw;
 try{raw=JSON.parse(text);}catch{raw=jsonLines(text,source);}
 const items=Array.isArray(raw)&&raw.every(row=>['user','assistant'].includes(row?.role))
  ?[{messages:raw}]:Array.isArray(raw)?raw:[raw];
 const chats=[];
 for(const item of items){
  if(!item||typeof item!=='object')continue;
  const chat=item.chat||item;
  const rows=source==='open-webui'?webuiHistory(chat):chat.chat_messages||chat.messages;
  const messages=array(rows).filter(row=>row&&row.done!==false).map(row=>
   message(row.role||({human:'user',assistant:'assistant'}[row.sender]),content(row.content)||row.text))
   .filter(row=>['user','assistant'].includes(row.role)&&row.text&&!/^<\/?(?:system-reminder|local-command|command-)/i.test(row.text));
  if(!messages.length)continue;
  const title=String(chat.title||chat.name||messages.find(m=>m.role==='user')?.text||fileName).slice(0,120);
  const external=chat.id||item.id||chat.uuid;
  const id=typeof external==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(external)?external:
   await stableId(JSON.stringify([source,external??'',messages[0]]));
  chats.push({id,title,updated:timestamp(item.updated_at??chat.updated_at??chat.update_time),messages:messages.slice(-16)});
 }
 return chats.sort((a,b)=>b.updated-a.updated);
}

export function mountContext(container,api,current){
 const $=id=>container.querySelector('#'+id);
 const status=text=>{if(current())$('contextStatus').textContent=text;};
 let busy=false, items=[], selected=[], read=0;
 function button(label,run){
  const node=document.createElement('button');node.type='button';node.className='secondary';node.textContent=label;node.onclick=run;return node;
 }
 function card(title,description,...controls){
  const node=document.createElement('div'),head=document.createElement('h3'),meta=document.createElement('p');
  node.className='item';head.textContent=title;meta.className='muted';meta.textContent=description;node.append(head,meta,...controls);return node;
 }
 async function action(action,extra={}){
  return api('action',{action,...extra});
 }
 async function refresh(){
  const state=await action('context_list');if(!current())return;
  const chats=$('contextChats'),connections=$('contextConnections');
  chats.replaceChildren();connections.replaceChildren();
  for(const entry of state.chats){
   const open=button('查看',async()=>{
    const request=++read;
    try{
     const detail=await action('context_detail',{id:entry.id});if(!current()||request!==read)return;
     $('contextDetail').hidden=false;$('contextDetailTitle').textContent=detail.title;
     $('contextDetailText').textContent=detail.messages.map(m=>(m.role==='user'?'我':'助手')+'\n'+m.text).join('\n\n');
    }catch(e){status(e.message);}
   });
   chats.append(card(entry.title,sources[entry.source]+' · '+new Date(entry.updated).toLocaleString()+(entry.pinned?' · 当前上下文':''),
    open,button(entry.pinned?'取消置为当前':'设为当前上下文',()=>mutate('context_pin',entry.id)),
    button('移除',()=>{if(confirm('移除这段对话？自动同步不会把它重新加回。'))mutate('context_remove',entry.id);})));
  }
  if(!state.chats.length)chats.textContent='还没有导入的会话。';
  for(const connection of state.connectors)connections.append(card(connection.name,
   sources[connection.source]+' · '+(connection.seen?'最近连接 '+new Date(connection.seen).toLocaleString():'等待连接器首次同步'),
   button('撤销授权',()=>{if(confirm('撤销后该连接器将停止上传，已导入会话可另行移除。'))mutate('context_revoke',connection.id);})));
  if(!state.connectors.length)connections.textContent='还没有自动同步授权。';
 }
 async function mutate(actionName,id){
  if(busy)return;
  busy=true;
  try{await action(actionName,{id});if(!current())return;read++;$('contextDetail').hidden=true;$('contextDetailText').textContent='';await refresh();status('已保存。');}
  catch(e){status(e.message);}finally{busy=false;}
 }
 function clearSelection(){
  items=[];selected=[];$('contextImportPreview').replaceChildren();$('contextImport').disabled=true;
 }
 $('contextImportSource').onchange=()=>{clearSelection();$('contextFile').value='';};
 $('contextFile').onchange=async()=>{
  const request=++read;clearSelection();
  const file=$('contextFile').files[0];if(!file)return;
  if(file.size>25*1024*1024)return status('文件超过 25 MB，请拆分后导入。');
  status('正在本机解析文件…');
  try{
   const parsed=await parseContextFile(await file.text(),$('contextImportSource').value,file.name);
   if(!current()||request!==read)return;
   items=parsed.slice(0,120);selected=items.map(()=>false);
   items.forEach((chat,index)=>{
    const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';
    check.onchange=()=>{selected[index]=check.checked;$('contextImport').disabled=!selected.some(Boolean);};
    label.append(check,document.createTextNode(' '+chat.title+' · '+chat.messages.length+' 条近期消息'));
    $('contextImportPreview').append(label);
   });
   status(items.length?'找到 '+parsed.length+' 段会话，请勾选要上传的条目。':'未找到可识别的会话文本。');
  }catch(e){status('无法解析此文件，请检查来源和格式。');}
 };
 $('contextImportForm').onsubmit=async event=>{
  event.preventDefault();if(busy||!selected.some(Boolean))return;busy=true;$('contextImport').disabled=true;
  let count=0;const source=$('contextImportSource').value, batch=items.filter((_,index)=>selected[index]);
  try{
   for(const chat of batch){if(!current())return;await action('context_import',{source,chat});count++;}
   if(!current())return;clearSelection();$('contextFile').value='';await refresh();status('已处理 '+count+' 段会话。');
  }catch(e){status('已处理 '+count+' 段。'+e.message);}
  finally{busy=false;if(current())$('contextImport').disabled=!selected.some(Boolean);}
 };
 $('contextAuthorizeForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;$('contextToken').value='';$('contextPairing').hidden=true;
  try{
   const source=$('contextSyncSource').value;
   const result=await action('context_authorize',{source,name:$('contextConnectorName').value.trim()});
   if(!current())return;
   $('contextToken').value=result.token;
   $('contextCommand').textContent='python voxi-context-sync.py setup --server '+location.origin+' --source '+source+
    (source==='open-webui'?' --webui http://localhost:8080 --chat 你的会话ID':' --project "你的项目目录"');
   $('contextPairing').hidden=false;await refresh();status('同步授权已创建。');
  }catch(e){status(e.message);}finally{busy=false;}
 };
 $('contextCopy').onclick=async()=>{
  try{await navigator.clipboard.writeText($('contextToken').value);status('配对密钥已复制。');}
  catch{$('contextToken').type='text';$('contextToken').select();}
 };
 $('refreshContext').onclick=()=>refresh().catch(e=>status(e.message));
 void refresh().catch(e=>status(e.message));
}
