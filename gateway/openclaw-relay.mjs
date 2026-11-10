// Connector credentials can reach only their fixed, scoped Pocket relay action.
// The internal Pocket bearer never leaves this server.
export function openClawRelay(call) {
  let inFlight=0;
  return async(req,res,engine='openclaw')=>{
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    if(!call)return reply(503,{error:'Pocket 模式未启用'});
    if(req.method!=='POST'||req.headers.origin)return reply(403,{error:'连接器请求被拒绝'});
    const auth=req.headers.authorization||'';
    if(!/^Bearer [A-Za-z0-9_-]{40,64}$/.test(auth))return reply(401,{error:'连接凭据无效'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return reply(415,{error:'需要 JSON'});
    if(inFlight>=32)return reply(429,{error:'请稍后重试'});
    inFlight++;
    try{
      const chunks=[];let bytes=0;
      req.setTimeout(10000,()=>req.destroy());
      for await(const chunk of req){bytes+=chunk.length;if(bytes>262144)return reply(413,{error:'请求过大'});chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!body||!['poll','result'].includes(body.op)||!/^([a-f0-9]{32})$/.test(body.connectionId||''))return reply(400,{error:'连接器请求无效'});
      const result=await call({...body,action:'relay',relayEngine:engine,relayToken:auth.slice(7)});
      return reply(200,result);
    }catch{return reply(400,{error:'连接器请求未确认，请检查配对和服务状态'});}
    finally{inFlight--;}
  };
}
