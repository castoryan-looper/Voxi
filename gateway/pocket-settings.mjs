import http from 'node:http';
import https from 'node:https';

// Only the dedicated voice configuration endpoint; never proxy console/account APIs.
export function pocketSettings({url,token,ca},endpoint='config') {
  if(!['config','memory'].includes(endpoint))throw Error('Unsupported Pocket settings endpoint');
  return value=>new Promise((resolve,reject)=>{
    const target=new URL(url);target.protocol=target.protocol==='wss:'?'https:':'http:';target.pathname='/voxi/'+endpoint;target.search='';target.hash='';
    const body=value===undefined?undefined:JSON.stringify(value);
    const request=(target.protocol==='https:'?https:http).request(target,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})},...(ca?{ca}:{})},response=>{
      let raw='';response.setEncoding('utf8');response.on('data',part=>{raw+=part;if(Buffer.byteLength(raw)>(endpoint==='memory'?16777216:1048576))request.destroy(Error('Configuration response too large'));});
      response.on('end',()=>{
        if(response.statusCode!==200)return reject(Error(response.statusCode===404?'请先更新 Pocket 后端以启用'+(endpoint==='memory'?'长期记忆':' AI 配置'):response.statusCode===400?'配置无效，请检查文本长度和数值范围':response.statusCode===401||response.statusCode===403?'Pocket 配置鉴权失败，请执行 deploy/connect-pocket.sh 重新关联后端':response.statusCode===500?'Pocket 配置持久存储失败，请检查后端容器日志':'Pocket 配置服务暂不可用（HTTP '+response.statusCode+'），请检查后端部署'));
        try{resolve(JSON.parse(raw));}catch{reject(Error('Pocket 配置响应无效'));}
      });
    });
    const deadline=setTimeout(()=>request.destroy(Error('Pocket 配置请求超时')),8000);deadline.unref();
    request.on('close',()=>clearTimeout(deadline));request.on('error',error=>reject(Error(error.message==='Pocket 配置请求超时'?error.message:({ENOTFOUND:'找不到 Pocket 后端，请检查共享 Docker 网络',ECONNREFUSED:'Pocket 配置端口未运行，请检查后端容器',ECONNRESET:'Pocket 配置连接被重置，请检查后端运行状态'}[error.code]||'无法连接 Pocket 配置服务，请检查后端部署'))));
    request.end(body);
  });
}
