import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {passwordHash,verifyPassword} from './admin-auth.mjs';
const encoded=/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/;
const usernameValid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@-]{3,64}$/.test(value);
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const dummy='scrypt:'+'0'.repeat(32)+':'+'0'.repeat(128);

export function createUserAccounts({file,administrator,agent,portal,memory,webMemory,voicePreview,secure=true}={}){
 let accounts=[];const sessions=new Map();let editing=false,checking=false,failures=0,windowAt=0;
 if(file){try{const data=JSON.parse(readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.accounts))throw Error('Invalid user accounts file');accounts=data.accounts;}catch(e){if(e.code!=='ENOENT')throw e;}}
 const ids=new Set(),names=new Set(),owners=new Set();
 for(const a of accounts){if(!/^[a-f0-9]{32}$/.test(a.id)||!usernameValid(a.username)||!encoded.test(a.passwordHash)||!/^([a-f0-9]{32})$/.test(a.userId)||a.role!=='user'||typeof a.enabled!=='boolean'||ids.has(a.id)||names.has(a.username.toLowerCase())||owners.has(a.userId))throw Error('Invalid user account record');ids.add(a.id);names.add(a.username.toLowerCase());owners.add(a.userId);}
 function save(next){if(!file)throw Error('尚未启用普通账户持久存储');writeFileSync(file+'.tmp',JSON.stringify({version:1,accounts:next})+'\n',{mode:0o600});renameSync(file+'.tmp',file);accounts=next;}
 const publicAccount=a=>({id:a.id,username:a.username,userId:a.userId,role:'user',enabled:a.enabled});
 function revoke(id){for(const [key,s] of sessions)if(s.accountId===id)sessions.delete(key);}
 function session(req){const id=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('voxi_user='))?.slice(10),s=sessions.get(id);if(!s)return null;const account=accounts.find(a=>a.id===s.accountId&&a.enabled);if(s.until<=Date.now()||!account){sessions.delete(id);return null;}return {id,...s,account};}
 const cookie=(id,age)=>`voxi_user=${id}; Path=/api/user/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
 const ready=()=>{if(!agent||!portal)throw Error('用户服务需要 Pocket Cloud 模式');};

 async function admin(body){
  ready();if(editing)throw Error('账户正在保存，请稍后重试');
  if(body){editing=true;try{
   if(!file)throw Error('尚未启用普通账户持久存储');
   const action=body.action;
   if(action==='create'){
    if(!usernameValid(body.username)||body.username.toLowerCase()===(administrator||'admin').toLowerCase()||accounts.some(a=>a.username.toLowerCase()===body.username.toLowerCase()))throw Error('登录名需要3–64个英文字母、数字或 ._@-，且不能重复');
    if(typeof body.password!=='string'||body.password.length<8||body.password.length>128)throw Error('初始密码需要8–128字符');
    if(body.role&&body.role!=='user')throw Error('此入口只能创建普通账户');
    let state=await agent();if(state.runtime?.userPortalVersion!==1)throw Error('请先升级 Pocket 后端以启用用户空间');
    let userId=body.userId;
    if(!userId){const created=await agent({action:'create_profile',name:body.name});userId=created.profile.id;}
    state=await agent();if(!state.users.some(u=>u.id===userId))throw Error('用户档案不存在');
    if(accounts.some(a=>a.userId===userId))throw Error('此用户档案已绑定登录账户');
    const next={id:randomBytes(16).toString('hex'),username:body.username,userId,role:'user',enabled:true,passwordHash:await passwordHash(body.password)};
    save([...accounts,next]);
   }else{
    const a=accounts.find(a=>a.id===body.accountId);if(!a)throw Error('账户不存在');
    if(action==='enabled'){if(typeof body.enabled!=='boolean')throw Error('账户状态无效');save(accounts.map(x=>x.id===a.id?{...x,enabled:body.enabled}:x));}
    else if(action==='password'){if(typeof body.password!=='string'||body.password.length<8||body.password.length>128)throw Error('新密码需要8–128字符');const hash=await passwordHash(body.password);save(accounts.map(x=>x.id===a.id?{...x,passwordHash:hash}:x));}
    else throw Error('账户操作无效');
    revoke(a.id);
   }
  }finally{editing=false;}}
  let profiles=[],directoryAvailable=true;
  try{profiles=memory?(await memory({action:'directory'})).profiles:(await agent()).users.map(u=>({id:u.id,name:u.name}));}
  catch{directoryAvailable=false;}
  return {accounts:accounts.map(publicAccount),profiles,directoryAvailable,persistent:Boolean(file)};
 }

 async function detail(userId,section){
  if(!memory)throw Error('用户档案需要 Pocket Cloud 模式');
  const profile=await memory({action:'user_detail',userId,section});
  if(profile.profile?.id!==userId)throw Error('用户档案读取结果不匹配');
  const account=accounts.find(a=>a.userId===userId);
  return {...profile,account:account?publicAccount(account):null};
 }

 async function handle(req,res){
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return json(403,{error:'来源不允许'});}catch{return json(403,{error:'来源不允许'});}}
  let body;
  if(req.method==='POST'){
   if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'需要 JSON 请求'});
   let raw='';try{for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>131072)return json(413,{error:'请求过大'});}body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json(400,{error:'JSON 无效'});}
  }
  const path=req.url;
  if(path==='/api/user/login'&&req.method==='POST'){
   const now=Date.now();if(now-windowAt>60000){failures=0;windowAt=now;}if(failures>=8||checking)return json(429,{error:'登录尝试过多，请稍后重试'});
   if(!usernameValid(body.username)||typeof body.password!=='string'||body.password.length>256)return json(400,{error:'用户名或密码无效'});
   failures++;checking=true;let valid=false,a=accounts.find(a=>a.username.toLowerCase()===body.username.toLowerCase());
   try{valid=await verifyPassword(body.password,a?.passwordHash||dummy);}finally{checking=false;}
   const latest=accounts.find(x=>x.id===a?.id);
   if(!valid||!latest?.enabled||latest.passwordHash!==a?.passwordHash)return json(401,{error:'用户名、密码不正确，或账户已停用'});
   failures=0;for(const [id,s] of sessions)if(s.until<=now)sessions.delete(id);if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
   const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');sessions.set(id,{accountId:a.id,csrf,until:now+8*3600000});res.setHeader('Set-Cookie',cookie(id,28800));return json(200,{username:a.username,role:'user',csrf});
  }
  const current=session(req);
  if(!current||(req.method!=='GET'&&!equal(req.headers['x-csrf-token'],current.csrf)))return json(401,{error:'请登录普通用户账户'});
  if(path==='/api/user/session'&&req.method==='GET')return json(200,{username:current.account.username,role:'user',csrf:current.csrf});
  if(path==='/api/user/web-memory'&&['GET','POST'].includes(req.method)){
   if(!webMemory)return json(409,{error:'网页任务记忆存储未启用'});
   if(body&&('userId' in body||'actorUserId' in body))return json(403,{error:'不能指定其他身份'});
   try{return json(200,webMemory.manage(current.account.userId,body));}catch(e){return json(400,{error:e.message});}
  }
  if(path==='/api/user/logout'&&req.method==='POST'){sessions.delete(current.id);res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});}
  if(path==='/api/user/password'&&req.method==='POST'){
   if(checking||editing)return json(429,{error:'请稍后重试'});
   if(typeof body.currentPassword!=='string'||body.currentPassword.length>256||typeof body.newPassword!=='string'||body.newPassword.length<8||body.newPassword.length>128)return json(400,{error:'新密码需要8–128字符'});
   checking=editing=true;try{if(!await verifyPassword(body.currentPassword,current.account.passwordHash))return json(401,{error:'当前密码不正确'});const hash=await passwordHash(body.newPassword);save(accounts.map(a=>a.id===current.account.id?{...a,passwordHash:hash}:a));revoke(current.account.id);res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});}catch{return json(500,{error:'密码保存失败'});}finally{checking=editing=false;}
  }
  if(path==='/api/user/voice-preview'&&req.method==='POST'){
   if(!voicePreview)return json(409,{error:'试听服务尚未启用，请联系管理员更新'});
   if(Object.keys(body).some(k=>!['voice','language'].includes(k)))return json(403,{error:'试听不能指定身份或自定义文本'});
   const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);
   try{const result=await voicePreview({voice:body.voice,...(body.language!==undefined?{language:body.language}:{}),actorUserId:current.account.userId},{signal:controller.signal});if(!session(req))return json(401,{error:'账户会话已失效'});return json(200,result);}catch(e){if(!res.destroyed)return json(502,{error:e.message});}finally{res.off('close',abort);}
  }
  if((path==='/api/user/state'&&req.method==='GET')||(path==='/api/user/action'&&req.method==='POST')){
   try{ready();const action=body||{action:'snapshot'};if('actorUserId' in action||'userId' in action||'role' in action)return json(403,{error:'不能指定其他身份'});
    const userId=current.account.userId,packet={...action,actorUserId:userId};
    const send=body=>{
      if(session(req)?.id!==current.id)throw Error('账户会话已失效');
      return portal(body);
    };
    const data=webMemory?await webMemory.forward(send,packet,userId):await send(packet);
    return json(200,data);
   }catch(e){return json(400,{error:e.message});}
  }
  return json(404,{error:'接口不存在'});
 }
 return {admin,detail,handle,accountCount:()=>accounts.length};
}
