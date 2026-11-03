import {createAdminAuth} from './admin-auth.mjs';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';

export function createAdmin({token,stateFile,initialLimit=2,capacity=4,snapshot,disconnect,aiConfiguration,memoryConfiguration,username,passwordHash,accountFile,secureCookies=true}={}) {
  const auth=createAdminAuth({username,passwordHash,file:accountFile,secure:secureCookies});
  const valid=n=>Number.isInteger(n)&&n>=1&&n<=capacity;
  if(!valid(initialLimit))throw Error(`MAX_CONNECTIONS must be an integer from 1 to ${capacity}`);
  let limit=initialLimit;
  if(stateFile){
    try{const saved=JSON.parse(readFileSync(stateFile,'utf8'));if(!valid(saved.maxConnections))throw Error('Invalid saved connection limit');limit=saved.maxConnections;}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const events=[];
  function record(event){events.unshift({at:new Date().toISOString(),...event});events.length=Math.min(events.length,50);}
  function setLimit(value){
    if(!valid(value))throw Error(`设备数量必须为 1–${capacity} 的整数`);
    if(stateFile){writeFileSync(stateFile+'.tmp',JSON.stringify({maxConnections:value})+'\n',{mode:0o600});renameSync(stateFile+'.tmp',stateFile);}
    limit=value;record({event:'limit_changed',maxConnections:value});
  }
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
    if(req.method==='GET'&&req.url==='/api/admin/status')return json(200,{...snapshot(),maxConnections:limit,capacity,persistent:Boolean(stateFile),events});
    if(req.method==='GET'&&req.url==='/api/admin/memory'){
      if(!memoryConfiguration)return json(409,{error:'当前模式未启用用户记忆'});
      try{return json(200,await memoryConfiguration());}catch(error){return json(502,{error:error.message});}
    }
    if(req.method==='GET'&&req.url==='/api/admin/ai'){
      if(!aiConfiguration)return json(409,{error:'当前模式未启用 Pocket AI 配置'});
      try{return json(200,await aiConfiguration());}catch(error){return json(502,{error:error.message});}
    }
    if(req.method!=='POST')return json(405,{error:'不支持此请求'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'需要 JSON 请求'});
    body='';
    try{
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>131072)return json(413,{error:'请求过大'});}
      body=JSON.parse(body);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
    }catch{return json(400,{error:'JSON 无效'});}
    if(req.url==='/api/admin/memory'){
      if(!memoryConfiguration)return json(409,{error:'当前模式未启用用户记忆'});
      try{const result=await memoryConfiguration(body);record({event:'memory_changed'});return json(200,result);}catch(error){return json(502,{error:error.message});}
    }
    if(req.url==='/api/admin/ai'){
      if(!aiConfiguration)return json(409,{error:'当前模式未启用 Pocket AI 配置'});
      try{const result=await aiConfiguration(body);record({event:'ai_config_changed'});return json(200,result);}
      catch(error){return json(502,{error:error.message});}
    }
    if(req.url==='/api/admin/limit'){
      if(!valid(body.maxConnections))return json(400,{error:`设备数量必须为 1–${capacity} 的整数`});
      try{setLimit(body.maxConnections);}catch{return json(500,{error:'保存失败，原数量上限保持不变'});}
      return json(200,{maxConnections:limit});
    }
    if(req.url==='/api/admin/disconnect'){
      if(!Number.isSafeInteger(body.connection)||body.connection<1)return json(400,{error:'连接编号无效'});
      if(!disconnect(body.connection))return json(404,{error:'该连接已离线'});
      record({event:'admin_disconnected',connection:body.connection});return json(200,{ok:true});
    }
    return json(404,{error:'接口不存在'});
  }
  return {get limit(){return limit;},record,handle};
}
