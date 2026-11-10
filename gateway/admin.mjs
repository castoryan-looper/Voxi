import {createAdminAuth} from './admin-auth.mjs';

const globalAssistantFields = new Set(['enabled','model','maxConcurrent','maxTaskSeconds','instructions']);
const agentTaskActions = new Set(['submit','detail','cancel','approve','decline','answer','continue']);
function globalAssistantSnapshot({settings,runtime,credentials}){
  return {settings,runtime,credentials};
}
import {timingSafeEqual} from 'node:crypto';

export function createAdmin({token,snapshot,overview,disconnect,aiConfiguration,agentConfiguration,memoryConfiguration,deviceRegistry,userAccounts,userDetail,userWebMemory,voicePreview,username,passwordHash,accountFile,secureCookies=true}={}) {
  const auth=createAdminAuth({username,passwordHash,file:accountFile,secure:secureCookies});
  const events=[];
  function record(event){events.unshift({at:new Date().toISOString(),...event});events.length=Math.min(events.length,50);}
  async function handle(req,res){
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return json(403,{error:'来源不允许'});}if(origin.host!==req.headers.host)return json(403,{error:'来源不允许'});}
    const authRoute=['/api/admin/login','/api/admin/logout','/api/admin/password','/api/admin/session'].includes(req.url);
    let body;
    if(authRoute&&req.method==='POST'){
      if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'需要 JSON 请求'});
      let raw='';try{for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)return json(413,{error:'请求过大'});}body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json(400,{error:'JSON 无效'});}
    }
    if(authRoute)return auth.handle(req,res,json,body);
    if(auth.enabled){if(!auth.authorize(req))return json(401,{error:'登录已过期，请重新登录'});}
    else {
      if(!token)return json(503,{error:'未配置管理员账户，请先更新部署'});
      const actual=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return json(401,{error:'管理密钥不正确'});
    }
    if(req.method==='GET'&&req.url==='/api/admin/status')return json(200,{...snapshot(),events});
    if(req.method==='GET'&&req.url==='/api/admin/overview')return json(200,await overview());
    if(req.method==='GET'&&req.url==='/api/admin/users'){
      try{return json(200,await userAccounts());}catch(e){return json(400,{error:e.message});}
    }
    const profilePath=/^\/api\/admin\/users\/([a-f0-9]{32})\/(profile|devices|memory|tasks)$/.exec(req.url);
    const webMemoryPath=/^\/api\/admin\/users\/([a-f0-9]{32})\/web-memory$/.exec(req.url);
    if(req.method==='GET'&&webMemoryPath){
      if(!userWebMemory)return json(409,{error:'网页任务记忆存储未启用'});
      try{return json(200,await userWebMemory(webMemoryPath[1]));}catch(e){return json(400,{error:e.message});}
    }
    if(req.method==='GET'&&profilePath){
      try{return json(200,await userDetail(profilePath[1],profilePath[2]));}catch(e){return json(502,{error:e.message});}
    }
    if(req.method==='GET'&&req.url==='/api/admin/devices'){
      if(!deviceRegistry)return json(409,{error:'设备档案未启用'});
      try{return json(200,await deviceRegistry());}catch(error){return json(502,{error:error.message});}
    }
    if(req.method==='GET'&&req.url==='/api/admin/memory'){
      if(!memoryConfiguration)return json(409,{error:'当前模式未启用用户记忆'});
      try{return json(200,await memoryConfiguration());}catch(error){return json(502,{error:error.message});}
    }
    if(req.method==='GET'&&req.url==='/api/admin/ai'){
      if(!aiConfiguration)return json(409,{error:'当前模式未启用 Pocket AI 配置'});
      try{return json(200,await aiConfiguration());}catch(error){return json(502,{error:error.message});}
    }
    if(req.method==='GET'&&req.url==='/api/admin/agent'){
      if(!agentConfiguration)return json(409,{error:'Voxi Agent 需要 Pocket Cloud 模式'});
      try{return json(200,globalAssistantSnapshot(await agentConfiguration()));}catch(error){return json(502,{error:error.message});}
    }
    if(req.method!=='POST')return json(405,{error:'不支持此请求'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'需要 JSON 请求'});
    body='';
    try{
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>131072)return json(413,{error:'请求过大'});}
      body=JSON.parse(body);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
    }catch{return json(400,{error:'JSON 无效'});}
    if(webMemoryPath){
      if(!userWebMemory)return json(409,{error:'网页任务记忆存储未启用'});
      try{return json(200,await userWebMemory(webMemoryPath[1],body));}catch(e){return json(400,{error:e.message});}
    }
    if(req.url==='/api/admin/users'){
      try{
        const result=await userAccounts(body);
        record(body.action==='delete'?{event:'user_deleted',userId:body.userId}:{event:'user_account_changed',action:body.action});
        return json(200,result);
      }catch(e){return json(400,{error:e.message});}
    }
    if(req.url==='/api/admin/voice-preview'){
      if(!voicePreview)return json(409,{error:'试听需要 Pocket Cloud 模式'});
      const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);
      try{return json(200,await voicePreview(body,{signal:controller.signal}));}catch(e){if(!res.destroyed)return json(502,{error:e.message});}finally{res.off('close',abort);}
    }
    if(req.url==='/api/admin/memory'){
      if(!memoryConfiguration)return json(409,{error:'当前模式未启用用户记忆'});
      try{const result=await memoryConfiguration(body);record({event:'memory_changed'});return json(200,result);}catch(error){return json(502,{error:error.message});}
    }
    if(req.url==='/api/admin/ai'){
      if(!aiConfiguration)return json(409,{error:'当前模式未启用 Pocket AI 配置'});
      try{const result=await aiConfiguration(body);record({event:'ai_config_changed'});return json(200,result);}
      catch(error){return json(502,{error:error.message});}
    }
    if(req.url==='/api/admin/agent'){
      if(!agentConfiguration)return json(409,{error:'Voxi Agent 需要 Pocket Cloud 模式'});
      const {action,settings}=body;
      if(action==='settings_patch'){
        if(!settings||typeof settings!=='object'||Array.isArray(settings)||!Object.keys(settings).length
          ||Object.keys(settings).some(field=>!globalAssistantFields.has(field)))
          return json(400,{error:'这里只能修改全局助手设置'});
      }else if(action!=='credential'&&!agentTaskActions.has(action)){
        return json(400,{error:'接入和频道请在用户个人空间管理'});
      }
      try{
        const result=await agentConfiguration(body);
        return json(200,agentTaskActions.has(action)?result:globalAssistantSnapshot(result));
      }catch(error){return json(502,{error:error.message});}
    }
    if(req.url==='/api/admin/disconnect'){
      if(!Number.isSafeInteger(body.connection)||body.connection<1)return json(400,{error:'连接编号无效'});
      if(!disconnect(body.connection))return json(404,{error:'该连接已离线'});
      record({event:'admin_disconnected',connection:body.connection});return json(200,{ok:true});
    }
    return json(404,{error:'接口不存在'});
  }
  return {record,handle};
}
