import WebSocket from 'ws';
const url=process.env.POCKET_URL,token=process.env.POCKET_DEVICE_TOKEN;
if(!url||!token){console.log('Pocket URL or device bearer is not configured');process.exit(1);}
const socket=new WebSocket(url,{handshakeTimeout:10000,headers:{Authorization:`Bearer ${token}`}});
const timeout=setTimeout(()=>{console.log('Native voice did not become ready within 55s');socket.terminate();},55000);
socket.on('open',()=>console.log('Pocket WebSocket OPEN'));
socket.on('message',(raw,binary)=>{
 if(binary)return;
 let event;try{event=JSON.parse(raw);}catch{return;}
 if(event.type==='connecting')console.log('Native voice: connecting');
 if(event.type==='ready'){console.log('Native voice READY');socket.close();}
 if(event.type==='error'){console.log('Native voice error:',String(event.message||'unknown').slice(0,500));socket.close();}
});
socket.on('unexpected-response',(_,response)=>{console.log('Pocket handshake HTTP',response.statusCode);response.resume();socket.terminate();});
socket.on('error',e=>console.log('Pocket socket error:',/^[A-Z_]+$/.test(e.code||'')?e.code:'handshake failed'));
socket.on('close',()=>clearTimeout(timeout));
