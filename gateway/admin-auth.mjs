import {randomBytes,scrypt as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const scrypt=promisify(derive);
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
export async function passwordHash(password){const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;}
async function verify(password,encoded){const [,salt,hash]=encoded.split(':');return equal((await scrypt(password,salt,64)).toString('hex'),hash);}
export function createAdminAuth({username,passwordHash:initialHash,file,secure=true}={}){
 let account=username&&initialHash?{username,passwordHash:initialHash}:null;
 if(file){try{account=JSON.parse(readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(account&&(!/^[A-Za-z0-9_.@-]{1,64}$/.test(account.username)||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(account.passwordHash)))throw Error('Invalid administrator account');
 const sessions=new Map();let failures=0,windowAt=0,checking=false;
 const cookie=(id,age)=>`voxi_admin=${id}; Path=/api/admin/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure?'; Secure':''}`;
 function session(req){const id=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('voxi_admin='))?.slice(11);const value=sessions.get(id);if(value&&value.until>Date.now())return {id,...value};if(id)sessions.delete(id);return null;}
 function prune(){for(const [id,s] of sessions)if(s.until<=Date.now())sessions.delete(id);}
 return {
  get enabled(){return Boolean(account);},
  authorize(req){const s=session(req);return s&&(req.method==='GET'||equal(req.headers['x-csrf-token'],s.csrf));},
  async handle(req,res,json,body){
   const path=req.url;
   if(path==='/api/admin/session'&&req.method==='GET'){const s=session(req);return json(s?200:401,s?{username:account.username,csrf:s.csrf}:{error:'请登录管理员账户'});}
   if(path==='/api/admin/login'&&req.method==='POST'){
    if(!account)return json(503,{error:'请先部署管理员账户配置'});
    const now=Date.now();if(now-windowAt>60000){windowAt=now;failures=0;}
    if(failures>=8||checking)return json(429,{error:'登录尝试过多，请稍后重试'});
    if(typeof body.username!=='string'||typeof body.password!=='string'||body.password.length>256)return json(400,{error:'用户名或密码无效'});
    failures++;checking=true;let ok=false;
    try{ok=await verify(body.password,account.passwordHash)&&equal(body.username,account.username);}finally{checking=false;}
    if(!ok)return json(401,{error:'用户名或密码不正确'});
    failures=0;prune();if(sessions.size>=20)sessions.delete(sessions.keys().next().value);
    const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');sessions.set(id,{csrf,until:now+8*3600000});
    res.setHeader('Set-Cookie',cookie(id,8*3600));return json(200,{username:account.username,csrf});
   }
   const current=session(req);
   if(!current||!equal(req.headers['x-csrf-token'],current.csrf))return json(401,{error:'登录已过期，请重新登录'});
   if(path==='/api/admin/logout'&&req.method==='POST'){sessions.delete(current.id);res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});}
   if(path==='/api/admin/password'&&req.method==='POST'){
    if(!file)return json(503,{error:'未启用账户持久存储'});
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>256||typeof body.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>128)return json(400,{error:'新密码需要 12–128 个字符'});
    if(checking)return json(429,{error:'请稍后重试'});checking=true;
    try{
     if(!await verify(body.currentPassword,account.passwordHash))return json(401,{error:'当前密码不正确'});
     const next={username:account.username,passwordHash:await passwordHash(body.newPassword)};
     writeFileSync(file+'.tmp',JSON.stringify(next)+'\n',{mode:0o600});renameSync(file+'.tmp',file);account=next;sessions.clear();res.setHeader('Set-Cookie',cookie('',0));return json(200,{ok:true});
    }finally{checking=false;}
   }
   return json(404,{error:'接口不存在'});
  }
 };
}
