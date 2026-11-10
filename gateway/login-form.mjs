export function isLoginForm(req,path){
  return req.url===path&&req.method==='POST'
    &&req.headers['content-type']?.split(';')[0]==='application/x-www-form-urlencoded';
}

export async function handleLoginForm(req,res,json,scope,authenticate){
  // The callers also validate Origin against the request host.
  if((req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')
    ||(!req.headers.origin&&req.headers['sec-fetch-site']!=='same-origin'))
    return json(403,{error:'来源不允许'});
  const chunks=[];
  let bytes=0;
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>4096)return json(413,{error:'请求过大'});
    chunks.push(chunk);
  }
  const form=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  const fallback=scope==='admin'?'/admin/overview':'/app/profile';
  const target=form.get('returnTo')||'';
  const safe=new RegExp('^/'+scope+'(?:/[a-z0-9-]+)*/?(?:#[a-z0-9-]+)?$');
  const [path,anchor]=(target.length<=200&&target===target.trim()&&safe.test(target)?target:fallback).split('#');
  const respond=status=>{
    const failure=status===200?'':status===429?'busy':status===400||status===401?'invalid':'unavailable';
    const location=path+(failure?'?loginError='+failure:'')+(anchor?'#'+anchor:'');
    res.writeHead(303,{'Location':location,'Cache-Control':'no-store'});
    res.end();
  };
  return authenticate({username:form.get('username')?.trim(),password:form.get('password')},respond);
}
