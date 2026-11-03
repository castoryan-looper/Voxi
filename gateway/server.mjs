import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import WebSocket,{WebSocketServer} from 'ws';
import {channels,instructions,RadioFilter} from './radio.mjs';
import {attachPocket} from './pocket.mjs';

export function createGateway({mode='mock',token,apiKey,model='gpt-realtime-2.1',voice='marin',maxConnections=2,revision='dev',pocketUrl,pocketToken,pocketCa}={}) {
  if(!token) throw Error('Set DEVICE_TOKEN');
  if(!['mock','openai','pocket'].includes(mode)) throw Error('MODE must be mock, openai or pocket');
  if(mode==='openai'&&!apiKey) throw Error('Set OPENAI_API_KEY');
  if(mode==='pocket'&&(!pocketToken||!pocketUrl||!['ws:','wss:'].includes(new URL(pocketUrl).protocol)))throw Error('Set POCKET_URL and POCKET_DEVICE_TOKEN');
  const server=http.createServer((req,res)=>{
    if(req.url==='/setup/'||req.url==='/setup'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});
      res.end(readFileSync(new URL('./setup.html',import.meta.url)));return;
    }
    if(req.url!=='/healthz'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,mode,revision}));
  });
  const wss=new WebSocketServer({server,maxPayload:8192});
  let connectionSequence=0;
  wss.on('connection',(device,req)=>{
    const connection=++connectionSequence;let inputBytes=0;
    const openedAt=Date.now();let sentPings=0,pongs=0,pings=0,lastPongAt=openedAt,lastPingAt=0;
    const connectionMetrics=()=>({ageMs:Date.now()-openedAt,sentPings,pongs,pings,lastPongAgoMs:Date.now()-lastPongAt,lastPingAgoMs:lastPingAt?Date.now()-lastPingAt:null,queuedPcmBytes:device.downlinkQueuedBytes?.()??0,tcpBufferedBytes:device.bufferedAmount});
    // ws emits 'error' for malformed frames. Handle it before authentication
    // so one bad/disconnected client cannot terminate the whole gateway.
    device.on('error',error=>console.error(JSON.stringify({event:'device_ws_error',connection,code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'OTHER'})));
    device.on('message',(raw,binary)=>{
      if(binary){inputBytes+=raw.length;return;}
      let control;try{control=JSON.parse(raw);}catch{return;}
      if(['ptt_down','ptt_up'].includes(control?.type))console.log(JSON.stringify({event:'device_ptt',connection,type:control.type,inputBytes}));
    });
    device.on('close',(code)=>console.log(JSON.stringify({event:'device_closed',connection,code,inputBytes,origin:device.closeOrigin||'peer_or_transport',...connectionMetrics()})));

    if(req.url!=='/radio'||req.headers.authorization!==`Bearer ${token}`){device.close(1008,'Unauthorized');return;}
    if([...wss.clients].filter(c=>c.authenticated).length>=maxConnections){device.close(1013,'Device limit reached');return;}
    device.authenticated=true;
    device.isAlive=true;device.on('pong',()=>{device.isAlive=true;pongs++;lastPongAt=Date.now();});device.on('ping',()=>{pings++;lastPingAt=Date.now();});
    console.log(JSON.stringify({event:'device_opened',connection}));
    const heartbeat=setInterval(()=>{
      if(!device.isAlive){device.closeOrigin='heartbeat_timeout';console.warn(JSON.stringify({event:'device_heartbeat_timeout',connection,...connectionMetrics()}));device.terminate();return;}
      device.isAlive=false;sentPings++;device.ping();
    },30000);
    // A stale idle session must not keep a paid model connection forever.
    const lifetime=setInterval(()=>{
      if(mode==='pocket'&&device.radioBusy)return;
      device.closeOrigin='session_rotation';device.close(1000,'Session rotation');
    },30*60*1000);
    if(mode==='pocket'){
      attachPocket(device,{url:pocketUrl,token:pocketToken,ca:pocketCa});
      device.on('close',()=>{clearInterval(heartbeat);clearInterval(lifetime);});
      return;
    }
    let upstream,channel=0,ready=false,recording=false,bytes=0,epoch=0,timer,deadline,turn=0,responseId=null;
    let item=null,playedMs=0,responding=false,acceptOutput=false,filter=new RadioFilter(),released=0,first=true;
    let queued=Buffer.alloc(0),pump,sourceDone=false;
    const send=o=>{if(device.readyState===1)device.send(JSON.stringify(o));};
    const fail=message=>{clearTimeout(deadline);clearInterval(timer);clearInterval(pump);queued=Buffer.alloc(0);recording=false;ready=false;acceptOutput=false;send({type:'error',message});upstream?.close();};
    const api=o=>{if(upstream?.readyState===1)upstream.send(JSON.stringify(o));};
    function interrupt(){
      acceptOutput=false;clearInterval(timer);clearTimeout(deadline);turn++;responseId=null;
      clearInterval(pump);pump=null;queued=Buffer.alloc(0);sourceDone=false;
      // Also cancel a response whose response.created event has not arrived yet.
      api({type:'response.cancel'});
      responding=false;
      if(item)api({type:'conversation.item.truncate',item_id:item,content_index:0,audio_end_ms:playedMs});
      item=null;playedMs=0;send({type:'flush'});
    }
    function connect(){
      interrupt();epoch++;const mine=epoch;upstream?.close();ready=false;recording=false;
      send({type:'connecting',channel});
      if(mode==='mock'){ready=true;send({type:'ready',channel,name:channels[channel].name});return;}
      upstream=new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`,{handshakeTimeout:10000,headers:{Authorization:`Bearer ${apiKey}`}});
      deadline=setTimeout(()=>fail('Session setup timed out'),12000);
      const socket=upstream;
      socket.on('open',()=>{if(mine!==epoch)return;api({type:'session.update',session:{type:'realtime',output_modalities:['audio'],instructions:instructions(channel),audio:{input:{format:{type:'audio/pcm',rate:24000},turn_detection:null},output:{format:{type:'audio/pcm',rate:24000},voice}}}});});
      socket.on('message',raw=>{
        if(mine!==epoch)return;
        let e;try{e=JSON.parse(raw);}catch{return fail('Invalid upstream JSON');}
        if(e.type==='session.updated'){clearTimeout(deadline);ready=true;send({type:'ready',channel,name:channels[channel].name});}
        if(e.type==='response.created'&&e.response?.metadata?.turn===String(turn)){responding=true;responseId=e.response.id;}
        if(e.type==='response.output_audio.delta'&&acceptOutput&&e.response_id===responseId){
          if(item!==e.item_id){item=e.item_id;playedMs=0;send({type:'audio_start'});}
          output(Buffer.from(e.delta,'base64'));
        }
        if(e.type==='response.done'&&e.response?.id===responseId){
          clearTimeout(deadline);responding=false;
          if(['failed','incomplete'].includes(e.response.status))return fail('Model response failed or incomplete');
          if(acceptOutput){sourceDone=true;startPump();}
        }
        if(e.type==='error'){
          if(e.error?.code==='response_cancel_not_active')return;
          console.error('upstream',e.error?.code);fail(e.error?.message||'Upstream error');
        }
      });
      socket.on('error',()=>{if(mine===epoch)fail('Upstream connection failed');});
      socket.on('close',()=>{if(mine===epoch){ready=false;send({type:'offline'});}});
    }
    function output(data){
      if(queued.length+data.length>960000)return fail('Reply exceeded bounded playback queue');
      queued=Buffer.concat([queued,filter.process(data)]);startPump();
    }
    function startPump(){
      if(pump)return;
      // Pace model bursts to real-time audio; ESP32 only needs a small jitter buffer.
      pump=setInterval(()=>{
        if(device.bufferedAmount>9600)return fail('Playback network too slow');
        if(queued.length){
          if(first){first=false;console.log(JSON.stringify({event:'first_audio',channel,ms:Date.now()-released}));}
          const frame=queued.subarray(0,960);queued=queued.subarray(frame.length);
          if(device.readyState===1)device.send(frame);
        }else if(sourceDone){clearInterval(pump);pump=null;acceptOutput=false;send({type:'audio_end'});}
      },20);
    }
    device.on('message',(raw,binary)=>{
      if(binary){
        if(!recording||!ready)return;
        if(raw.length%2)return fail('PCM must contain complete samples');
        bytes+=raw.length;
        if(bytes>48000*20)return fail('PTT exceeded 20 seconds; reconnect');
        if(mode==='openai'){
          if(upstream.bufferedAmount>48000)return fail('Upload network too slow');
          api({type:'input_audio_buffer.append',audio:raw.toString('base64')});
        }
        return;
      }
      let e;try{e=JSON.parse(raw);}catch{return send({type:'error',message:'Invalid JSON'});}
      if(!e||typeof e!=='object'||Array.isArray(e))return send({type:'error',message:'Expected event object'});
      if(e.type==='channel'&&Number.isInteger(e.channel)&&channels[e.channel]){channel=e.channel;connect();}
      else if(e.type==='played'&&Number.isFinite(e.ms))playedMs=Math.max(0,Math.min(e.ms,60000));
      else if(e.type==='ptt_down'&&ready&&!recording){interrupt();filter=new RadioFilter();api({type:'input_audio_buffer.clear'});recording=true;bytes=0;send({type:'recording'});}
      else if(e.type==='ptt_up'&&recording){
        recording=false;
        if(bytes<4800){api({type:'input_audio_buffer.clear'});send({type:'idle',reason:'too_short'});return;}
        released=Date.now();first=true;acceptOutput=true;send({type:'thinking'});
        if(mode==='openai'){api({type:'input_audio_buffer.commit'});api({type:'response.create',response:{metadata:{turn:String(turn)}}});deadline=setTimeout(()=>fail('Response timed out; reconnect'),20000);}
        else {
          send({type:'audio_start'});let frame=0;
          timer=setInterval(()=>{const b=Buffer.alloc(960);for(let i=0;i<480;i++)b.writeInt16LE(Math.round(Math.sin(2*Math.PI*(550+channel*120)*(frame*480+i)/24000)*7000),i*2);output(b);if(++frame===15){clearInterval(timer);sourceDone=true;}},20);
        }
      }
    });
    device.on('close',()=>{epoch++;clearInterval(heartbeat);clearInterval(lifetime);clearInterval(timer);clearInterval(pump);clearTimeout(deadline);upstream?.close();});
    device.on('error',()=>{});
    connect();
  });
  return {server,wss};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {server,wss}=createGateway({mode:process.env.MODE||'mock',token:process.env.DEVICE_TOKEN,apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL,voice:process.env.OPENAI_VOICE,maxConnections:Number(process.env.MAX_CONNECTIONS||2),revision:process.env.REVISION||'dev',pocketUrl:process.env.POCKET_URL,pocketToken:process.env.POCKET_DEVICE_TOKEN,pocketCa:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined});
  server.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log('Radio gateway listening'));
  process.on('SIGTERM',()=>{
    for(const client of wss.clients)client.close(1012,'Service restarting');
    server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),4000).unref();
  });
}
