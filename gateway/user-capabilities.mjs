const $=id=>document.getElementById(id);

export function mountCapabilities({request, active, refresh}){
 let pending=false, preview=null, starter='';
 const status=$('capabilityStatus');
 const call=(action,fields)=>request({action,...fields});
 const text=(tag,value)=>{
  const el=document.createElement(tag);el.textContent=value;return el;
 };
 const link=(title,href)=>{
  const a=text('a',title);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;
 };
 function actionButton(label,handle){
  const b=text('button',label);b.type='button';b.className='secondary';b.onclick=handle;return b;
 }
 function run(button,operation){
  return async event=>{
   event?.preventDefault();
   if(pending||!active())return;
   pending=true;button.disabled=true;status.textContent='正在处理…';
   try{
    const message=await operation();
    if(active())status.textContent=message||'';
   }catch(error){if(active())status.textContent=error.message;}
   finally{pending=false;if(active())button.disabled=false;}
  };
 }
 function render(state){
  starter=state.starter;
  const list=$('importedSkills');list.replaceChildren();
  for(const skill of state.skills){
   const row=document.createElement('article');row.className='item';
   const remove=actionButton('移除',null);
   remove.onclick=run(remove,async()=>{
    if(!confirm('移除这个 Skill？'))return '';
    const next=await call('capability_skill_remove',{id:skill.id});
    if(active()){render(next);await refresh();}
    return 'Skill 已移除。';
   });
   row.append(text('h3',skill.name),text('p',skill.description),link(skill.publisher+' · '+skill.commit.slice(0,8),skill.source),' ',remove);
   list.append(row);
  }
  if(!state.skills.length)list.append(text('p','还没有导入的 Skill。内置的「代码审查」也可直接在频道中启用。'));
  const github=state.github;
  $('githubCapabilityState').textContent=github
   ?github.repository+(github.tested?' · 只读试跑通过 · '+new Date(github.tested*1000).toLocaleString():' · 授权已保存，等待试跑')
   :'等待授权';
  $('githubTestForm').hidden=$('githubRemove').hidden=!github;
  $('githubChannelLink').hidden=!github?.tested;
  if(github&&!$('githubRepository').value)$('githubRepository').value=github.repository;
  renderRemoteConnections(state.remotes||[]);
 }
 function labelField(title,input){
  const label=text('label',title);label.append(input);return label;
 }
 function configureRemote(server,entries){
  const box=$('mcpRemoteConfig'),form=document.createElement('form');
  box.replaceChildren(text('h3','配置 '+server.id));box.hidden=false;
  const select=document.createElement('select');
  for(const entry of entries){
   const option=text('option',entry.host);option.value=entry.index;select.append(option);
  }
  const fields=document.createElement('div'),connect=text('button','连接并列出工具');
  function showFields(){
   fields.replaceChildren();
   const entry=entries.find(e=>e.index===Number(select.value));
   fields.append(text('p','授权信息仅发送给 '+entry.host+'。'));
   for(const field of entry.fields){
    const input=document.createElement(field.choices.length&&!field.secret?'select':'input');
    if(input.tagName==='SELECT'){
     input.append(text('option',''));
     for(const value of field.choices)input.append(text('option',value));
    }else{
     input.type=field.secret?'password':'text';input.maxLength=2048;
     input.autocomplete=field.secret?'new-password':'off';
    }
    input.name=field.kind+':'+field.name;input.required=field.required;input.value=field.default||'';
    fields.append(labelField(field.name,input));
    if(field.description)fields.append(text('p',field.description));
   }
  }
  select.onchange=showFields;showFields();
  form.append(labelField('接入点',select),fields,connect);box.append(form);
  form.onsubmit=run(connect,async()=>{
   const values=Object.fromEntries(new FormData(form));
   for(const input of fields.querySelectorAll('input[type=password]'))input.value='';
   const result=await call('capability_remote_connect',{server:server.id,version:server.version,index:Number(select.value),values});
   if(active()){box.replaceChildren();box.hidden=true;render(result);}
   return '连接通过。选择可用工具并完成一次试跑，才能加入频道。';
  });
  select.focus();
 }
 function renderRemoteConnections(connections){
  const list=$('mcpRemoteConnections');list.replaceChildren();
  for(const conn of connections){
   const row=document.createElement('article');row.className='item';
   row.append(text('h3',conn.server),text('p',conn.host+' · '+conn.version+' · '+(conn.tested?'已试跑':'已连接，等待试跑')));
   const details=document.createElement('details'),form=document.createElement('form');
   details.append(text('summary','选工具并试跑'),form);
   const choices=document.createElement('fieldset');
   choices.className='mcp-tool-list';choices.append(text('legend','可在频道使用的工具'));
   const select=document.createElement('select'), schema=text('pre',''), args=document.createElement('textarea');
   args.rows=4;args.value='{}';args.maxLength=16000;args.required=true;
   for(const tool of conn.tools){
    const check=document.createElement('input');
    check.type='checkbox';check.name='tool';check.value=tool.name;check.checked=conn.selected.includes(tool.name);
    const label=text('label','');label.className='check';label.append(check,tool.name);
    choices.append(label);
    const option=text('option',tool.name);option.value=tool.name;select.append(option);
   }
   const schemaDetails=document.createElement('details');schemaDetails.append(text('summary','查看参数格式'),schema);
   let schemaRead=0;
   async function showSchema(){
    const read=++schemaRead;
    if(!schemaDetails.open)return;
    schema.textContent='正在读取参数格式…';
    try{
     const result=await call('capability_remote_schema',{id:conn.id,tool:select.value});
     if(active()&&read===schemaRead)schema.textContent=(result.description||'')+'\n'+JSON.stringify(result.schema,null,2);
    }catch(error){if(active()&&read===schemaRead)schema.textContent=error.message;}
   }
   select.onchange=showSchema;schemaDetails.ontoggle=showSchema;
   const test=text('button','运行试跑');
   form.append(choices,labelField('本次试跑工具',select),schemaDetails,labelField('JSON 参数',args),test);
   form.onsubmit=run(test,async()=>{
    let input;
    try{input=JSON.parse(args.value);}catch{throw Error('请输入有效的 JSON 参数对象。');}
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('请输入 JSON 对象。');
    const selected=new FormData(form).getAll('tool');
    if(!selected.includes(select.value))throw Error('请勾选本次试跑使用的工具。');
    if(!confirm('向 '+conn.host+' 发送这次 '+select.value+' 调用？第三方工具可能产生外部变更或费用。'))return '';
    const result=await call('capability_remote_test',{id:conn.id,selected,tool:select.value,arguments:input});
    if(active()){
     render(result);
     $('mcpRemoteResult').textContent=result.preview||'';
     $('mcpRemoteResult').hidden=!result.preview;
     await refresh();
    }
    return '试跑通过，可在「频道与助手」启用。任务调用远程工具前仍会请你确认。';
   });
   const remove=actionButton('移除接入',null);
   remove.onclick=run(remove,async()=>{
    if(!confirm('移除这个 MCP，并从所有频道解除绑定？'))return '';
    const next=await call('capability_remote_remove',{id:conn.id});
    if(active()){render(next);await refresh();}
    return '接入已移除。';
   });
   row.append(details,remove);list.append(row);
  }
 }
 function clearPreview(){
  preview=null;$('skillPreview').replaceChildren();$('skillPreview').hidden=true;
 }
 const previewSkill=run($('skillPreviewButton'),async()=>{
  clearPreview();
  const result=await call('capability_skill_preview',{url:$('skillUrl').value.trim()});
  if(!active())return;
  preview=result;
  const panel=$('skillPreview');
  panel.append(text('h3',result.name),text('p',result.description),link(result.publisher+' · '+result.commit.slice(0,8),result.source));
  const metadata=[result.license||'请查看源码仓库许可',result.compatibility,
   result.hasScripts?'包含脚本，本次导入仅加载指令和静态资料':'',...result.references].filter(Boolean);
  panel.append(text('p',metadata.join(' · ')));
  const review=document.createElement('details');
  review.append(text('summary','查看 Skill 指令'),text('pre',result.instructions));
  const add=actionButton('导入此版本',null);
  add.onclick=run(add,async()=>{
   const next=await call('capability_skill_add',{url:preview.source,commit:preview.commit});
   if(active()){clearPreview();render(next);await refresh();}
   return 'Skill 已导入，可在「频道与助手」启用。';
  });
  panel.append(review,add);panel.hidden=false;
  return '请核对来源和用途，再导入此版本。';
 });
 $('skillForm').onsubmit=previewSkill;
 $('skillUrl').oninput=clearPreview;
 $('skillStarter').onclick=()=>{if(starter&&!pending){$('skillUrl').value=starter;void previewSkill();}};
 $('mcpRegistryForm').onsubmit=run($('mcpRegistrySearch'),async()=>{
  const result=await call('capability_registry',{query:$('mcpRegistryQuery').value.trim()});
  if(!active())return;
  const list=$('mcpRegistryResults');list.replaceChildren();
  for(const server of result.servers){
   const row=document.createElement('article');row.className='item';
   row.append(text('h3',server.supported?'GitHub 只读 MCP':server.id),
    text('p',server.id+' · '+server.version+' · '+(server.supported?'Voxi 支持接入':server.configurable?'可配置远程 HTTPS':server.remote?'目录已收录 · 当前传输或端点不兼容':'目录已收录 · 需本地连接器')),
    text('p',server.description));
   if(server.supported)row.append(actionButton('配置 GitHub 只读 MCP',()=>{$('githubRepository').focus();}));
   if(server.configurable){
    const connect=actionButton('配置远程 MCP',null);
    connect.onclick=run(connect,async()=>{
     const result=await call('capability_remote_details',{server:server.id,version:server.version});
     if(active())configureRemote(server,result.entries);
    });
    row.append(connect);
   }
   list.append(row);
  }
  return result.servers.length?'找到 '+result.servers.length+' 个 Registry 条目。':'没有找到匹配的 MCP。';
 });
 $('githubCapabilityForm').onsubmit=run($('githubAuthorize'),async()=>{
  const token=$('githubCapabilityToken').value.trim();
  $('githubCapabilityToken').value='';
  const next=await call('capability_github_connect',{repository:$('githubRepository').value.trim(),token});
  if(active()){render(next);await refresh();}
  return '授权已保存。请运行只读试跑。';
 });
 $('githubTestForm').onsubmit=run($('githubTest'),async()=>{
  const next=await call('capability_github_test',{path:$('githubTestPath').value.trim(),pullNumber:Number($('githubTestPR').value)});
  if(active()){render(next);await refresh();}
  return 'GitHub MCP 已成功读取测试文件和 PR 差异，可在 Voxi Agent 频道启用。';
 });
 $('githubRemove').onclick=run($('githubRemove'),async()=>{
  if(!confirm('撤销 GitHub 授权并从所有频道移除这项能力？'))return '';
  const next=await call('capability_github_remove');
  if(active()){render(next);await refresh();}
  return '已撤销 Voxi 保存的授权并解绑频道。';
 });
 return {
  load:run($('skillStarter'),async()=>{const result=await call('capability_list');if(active())render(result);}),
  clear(){
   $('githubCapabilityToken').value='';$('githubRepository').value='';$('githubTestPath').value='README.md';$('githubTestPR').value='';
   $('skillUrl').value='';$('mcpRegistryQuery').value='github-mcp-server';clearPreview();
   $('importedSkills').replaceChildren();$('mcpRegistryResults').replaceChildren();
   for(const id of ['mcpRemoteConfig','mcpRemoteConnections','mcpRemoteResult'])$(id).replaceChildren();
   $('mcpRemoteConfig').hidden=$('mcpRemoteResult').hidden=true;
   $('githubCapabilityState').textContent='';status.textContent='';
   $('githubTestForm').hidden=$('githubRemove').hidden=$('githubChannelLink').hidden=true;
   for(const id of ['skillPreviewButton','skillStarter','mcpRegistrySearch','githubAuthorize','githubTest','githubRemove'])$(id).disabled=false;
  }
 };
}
