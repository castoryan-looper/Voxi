import {timingSafeEqual} from 'node:crypto';
import {readFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
export const targets=new Set(['waveshare_s3g_ota','waveshare_amoled18_v2_ota','zhengchen_minicam_20_ota','zhengchen_minicam_20_gpio11_ptt_ota']);
export function firmwareHandler({directory,token}){
 return async(req,res)=>{
  const deny=(code)=>{res.writeHead(code,{'Cache-Control':'no-store'});res.end();};
  const given=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);
  if(given.length!==expected.length||!timingSafeEqual(given,expected))return deny(401);
  if(req.method!=='GET')return deny(405);
  const match=/^\/api\/firmware\/([a-z0-9_]+)\/(manifest\.json|[a-f0-9]{64}\.bin)$/.exec(req.url);
  if(!match||!targets.has(match[1]))return deny(404);
  if(!directory)return deny(204);
  let file;
  try{
   const folder=join(directory,match[1]);
   if(match[2]==='manifest.json'){
    const bytes=await readFile(join(folder,'manifest.json'));if(bytes.length>2048)throw Error('oversize');
    const value=JSON.parse(bytes);const max=match[1]==='waveshare_s3g_ota'?3145728:4194304;
    if(value.schema!==1||value.target!==match[1]||!Number.isInteger(value.size)||value.size<256||value.size>max||!/^([a-f0-9]{64})$/.test(value.sha256))throw Error('invalid');
    // Publisher installs the immutable image first, manifest last.
    file=await open(join(folder,value.sha256+'.bin'),'r');if((await file.stat()).size!==value.size)throw Error('size');await file.close();file=null;
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Content-Length':bytes.length});res.end(bytes);return;
   }
   file=await open(join(folder,match[2]),'r');const stat=await file.stat();
   if(!stat.isFile()||stat.size>4194304)throw Error('invalid');
   res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   const stream=file.createReadStream();file=null;await pipeline(stream,res);
  }catch(e){if(res.headersSent)res.destroy();else deny(e.code==='ENOENT'?404:503);}
  finally{await file?.close();}
 };
}
