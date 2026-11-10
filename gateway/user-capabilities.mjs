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
  const metadata=[result.license||'请查看源码仓库许可',...result.references];
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
    text('p',server.id+' · '+server.version+' · '+(server.supported?'Voxi 支持接入':server.remote?'目录已收录 · 远程服务':'目录已收录 · 本地包')),
    text('p',server.description));
   if(server.supported)row.append(actionButton('配置 GitHub 只读 MCP',()=>{$('githubRepository').focus();}));
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
   $('githubCapabilityState').textContent='';status.textContent='';
   $('githubTestForm').hidden=$('githubRemove').hidden=$('githubChannelLink').hidden=true;
   for(const id of ['skillPreviewButton','skillStarter','mcpRegistrySearch','githubAuthorize','githubTest','githubRemove'])$(id).disabled=false;
  }
 };
}
