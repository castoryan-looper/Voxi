import {randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createWebSessions,SESSION_SECONDS} from './web-sessions.mjs';
import {handleLoginForm,isLoginForm} from './login-form.mjs';
const scrypt=promisify(derive);
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
export async function verifyPassword(password,encoded){const [,salt,hash]=encoded.split(':');return equal((await scrypt(password,salt,64)).toString('hex'),hash);}
const verify=verifyPassword;
export function createAdminAuth({username,passwordHash:initialHash,file,secure=true}={}){
 let account=username&&initialHash?{username,passwordHash:initialHash}:null;
 if(file){try{account=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(account&&(!/^[A-Za-z0-9_.@-]{1,64}$/.test(account.username)||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.passwordHash)))throw Error('Invalid administrator account');
 const sessions=createWebSessions({file:file&&file+'.sessions.sqlite',capacity:20,name:'voxi_admin',path:'/api/admin/',secure});
 let failures=0,windowAt=0,checking=false;
 const credential=()=>account.username+'\0'+account.passwordHash;
 function session(req){
   const value=account&&sessions.get(req);
   return value&&sessions.matches(value,credential())?value:null;
 }
 async function login(res,respond,body){
    if(!account)return respond(503,{error:'请先部署管理员账户配置'});
    const now=Date.now();if(now-windowAt>60000){windowAt=now;failures=0;}
    if(failures>=8||checking)return respond(429,{error:'登录尝试过多，请稍后重试'});
    if(typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>256)return respond(400,{error:'用户名或密码无效'});
    failures++;checking=true;let ok=false;
    try{ok=await verify(body.password,account.passwordHash)&&equal(body.username,account.username);}finally{checking=false;}
    if(!ok)return respond(401,{error:'用户名或密码不正确'});
    failures=0;
    let id,csrf;
    try{({id,csrf}=sessions.start('admin',credential()));}
    catch{return respond(503,{error:'登录会话无法保存，请稍后重试'});}
    res.setHeader('Set-Cookie',sessions.cookie(id,SESSION_SECONDS));return respond(200,{username:account.username,role:'admin',csrf});
 }
 return {
  get enabled(){return Boolean(account);},
  authorize(req){const s=session(req);return s&&(req.method==='GET'||equal(req.headers['x-csrf-token'],s.csrf));},
  close:sessions.close,
  async handle(req,res,json,body){
   const path=req.url;
   if(path==='/api/admin/session'&&req.method==='GET'){const s=session(req);return json(s?200:401,s?{username:account.username,role:'admin',csrf:s.csrf}:{error:'请登录管理员账户'});}
   if(path==='/api/admin/login'&&req.method==='POST'){
    if(isLoginForm(req,path))return handleLoginForm(req,res,json,'admin',(form,respond)=>login(res,respond,form));
    return login(res,json,body);
   }
   const current=session(req);
   if(!current||!equal(req.headers['x-csrf-token'],current.csrf))return json(401,{error:'登录已过期，请重新登录'});
   if(path==='/api/admin/logout'&&req.method==='POST'){sessions.remove(current.key);res.setHeader('Set-Cookie',sessions.cookie('',0));return json(200,{ok:true});}
   if(path==='/api/admin/password'&&req.method==='POST'){
    if(!file)return json(503,{error:'未启用账户持久存储'});
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>256||typeof body.newPassword!=='string'||body.newPassword.length<8||body.newPassword.length>128)return json(400,{error:'新密码需要 8–128 个字符'});
    if(checking)return json(429,{error:'请稍后重试'});checking=true;
    try{
     if(!await verify(body.currentPassword,account.passwordHash))return json(401,{error:'当前密码不正确'});
     const next={username:account.username,passwordHash:await passwordHash(body.newPassword)};
     sessions.revoke('admin');
     writeFileSync(file+'.tmp',JSON.stringify(next)+'\n',{mode:0o600});renameSync(file+'.tmp',file);account=next;res.setHeader('Set-Cookie',sessions.cookie('',0));return json(200,{ok:true});
    }finally{checking=false;}
   }
   return json(404,{error:'接口不存在'});
  }
 };
}
