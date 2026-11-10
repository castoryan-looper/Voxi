import http from 'node:http';
import https from 'node:https';

// Only the dedicated voice configuration endpoint; never proxy console/account APIs.
export function pocketSettings({url,token,ca},endpoint='config') {
  if(!['config','memory','devices','agent','portal','voice-preview','overview'].includes(endpoint))throw Error('Unsupported Pocket settings endpoint');
  return (value,{signal}={})=>new Promise((resolve,reject)=>{
    const target=new URL(url);target.protocol=target.protocol==='wss:'?'https:':'http:';target.pathname='/voxi/'+endpoint;target.search='';target.hash='';
    const body=value===undefined?undefined:JSON.stringify(value);
    const request=(target.protocol==='https:'?https:http).request(target,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{})},...(ca?{ca}:{})},response=>{
      let raw='';response.setEncoding('utf8');response.on('data',part=>{raw+=part;if(Buffer.byteLength(raw)>(endpoint==='memory'?16777216:endpoint==='voice-preview'?2097152:1048576))request.destroy(Error('Configuration response too large'));});
      response.on('end',()=>{
        if(endpoint==='voice-preview'&&response.statusCode!==200){try{return reject(Error(JSON.parse(raw).error||'试听未完成'));}catch{return reject(Error('试听服务暂不可用'));}}
        if(['agent','portal','memory'].includes(endpoint)&&response.statusCode===400){try{return reject(Error(JSON.parse(raw).error||'请求无效'));}catch{return reject(Error('请求无效'));}}
        if(response.statusCode!==200)return reject(Error(response.statusCode===404?'请先更新 Pocket 后端以启用'+(endpoint==='memory'?'长期记忆':' AI 配置'):response.statusCode===400?'配置无效，请检查文本长度和数值范围':response.statusCode===401||response.statusCode===403?'Pocket 配置鉴权失败，请执行 deploy/connect-pocket.sh 重新关联后端':response.statusCode===500?'Pocket 配置持久存储失败，请检查后端容器日志':'Pocket 配置服务暂不可用（HTTP '+response.statusCode+'），请检查后端部署'));
        try{resolve(JSON.parse(raw));}catch{reject(Error('Pocket 配置响应无效'));}
      });
    });
    const timeout=endpoint==='voice-preview'?90000:endpoint==='portal'&&typeof value?.action==='string'&&value.action.startsWith('capability_')?19000:['portal','agent'].includes(endpoint)&&['connect_model','test_model'].includes(value?.action)?11000:8000;
    const deadline=setTimeout(()=>request.destroy(Error('Pocket 配置请求超时')),timeout);deadline.unref();
    const abort=()=>request.destroy(Error('请求已取消'));
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    request.on('close',()=>{clearTimeout(deadline);signal?.removeEventListener('abort',abort);});request.on('error',error=>reject(Error(error.message==='Pocket 配置请求超时'||error.message==='请求已取消'?error.message:({ENOTFOUND:'找不到 Pocket 后端，请检查共享 Docker 网络',ECONNREFUSED:'Pocket 配置端口未运行，请检查后端容器',ECONNRESET:'Pocket 配置连接被重置，请检查后端运行状态'}[error.code]||'无法连接 Pocket 配置服务，请检查后端部署'))));
    request.end(body);
  });
}
