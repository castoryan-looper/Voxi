import {rotateSession} from './session-policy.mjs';
import {OpusDownlink,OPUS_FORMAT,OPUS_BITRATE} from './opus.mjs';
import {OPUS_BATCH_FORMAT} from './opus-batch.mjs';
import {UplinkDecoder,UPLINK_FORMAT} from './uplink.mjs';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import WebSocket,{WebSocketServer} from 'ws';
import {channels,instructions,RadioFilter} from './radio.mjs';
import {attachPocket} from './pocket.mjs';
import {createAdmin} from './admin.mjs';
import {pocketSettings} from './pocket-settings.mjs';
import {openClawRelay} from './openclaw-relay.mjs';
import {createUserAccounts} from './user-accounts.mjs';
import {createWebMemory} from './web-memory.mjs';

export function createGateway({mode='mock',token,apiKey,model='gpt-realtime-2.1',voice='marin',revision='dev',pocketUrl,pocketToken,pocketCa,adminToken,adminStateFile,adminUsername,adminPasswordHash,requireDeviceEnrollment=mode==='pocket'}={}) {
  if(!token) throw Error('Set DEVICE_TOKEN');
  if(!['mock','openai','pocket'].includes(mode)) throw Error('MODE must be mock, openai or pocket');
  if(mode==='openai'&&!apiKey) throw Error('Set OPENAI_API_KEY');
  if(mode==='pocket'&&(!pocketToken||!pocketUrl||!['ws:','wss:'].includes(new URL(pocketUrl).protocol)))throw Error('Set POCKET_URL and POCKET_DEVICE_TOKEN');
  const relay=openClawRelay(mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'agent'):undefined);
  const pocketMemory=mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'memory'):undefined;
  const webMemory=pocketMemory&&adminStateFile?createWebMemory(adminStateFile+'.web-memory.sqlite',
    userId=>pocketMemory({action:'user_detail',userId,section:'tasks'})):null;
  const pocketAgent=mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'agent'):undefined;
  const pocketPortal=mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'portal'):undefined;
  const users=createUserAccounts({file:adminStateFile?adminStateFile+'.users':undefined,administrator:adminUsername,
    memory:pocketMemory,webMemory,
    disconnectUser:userId=>{
      for(const {device,ownerId} of connected.values())if(ownerId===userId){device.closeOrigin='user_access_revoked';device.terminate();}
    },
    voicePreview:mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'voice-preview'):undefined,
    agent:pocketAgent,
    portal:pocketPortal});
  let syncing=0;
  async function contextSync(req,res){
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    if(!pocketPortal)return reply(404,{error:'同步服务未启用'});
    if(req.method!=='POST'||req.headers.origin||!/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization||''))
      return reply(403,{error:'同步授权无效'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return reply(415,{error:'需要 JSON 请求'});
    if(syncing>=8)return reply(429,{error:'同步服务繁忙'});
    syncing++;
    try{
      const chunks=[];
      let bytes=0;
      req.setTimeout(10000,()=>req.destroy());
      for await(const part of req){bytes+=part.length;if(bytes>115000)return reply(413,{error:'请求过大'});chunks.push(part);}
      const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).some(key=>key!=='chat'))
        return reply(400,{error:'同步数据格式无效'});
      const result=await pocketPortal({action:'context_ingest',token:req.headers.authorization.slice(7),
        enabledUsers:users.enabledProfiles(),chat:data.chat});
      return reply(200,result);
    }catch(error){if(!res.destroyed)return reply(400,{error:error.message});}
    finally{syncing--;}
  }
  const server=http.createServer((req,res)=>{
    if(req.url?.startsWith('/api/user/')){users.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});return;}
    if(req.url==='/api/context-sync'){void contextSync(req,res);return;}
    if(['/api/openclaw/relay','/api/muse-code/relay'].includes(req.url)){relay(req,res,req.url==='/api/muse-code/relay'?'muse':'openclaw').catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});return;}
    if(req.url?.startsWith('/api/admin/')){admin.handle(req,res).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});return;}
    const path=new URL(req.url,'http://gateway').pathname;
    const assets={'/shared/voice-preview.js':['voice-preview.mjs','text/javascript; charset=utf-8'],'/admin/assets/admin.js':['admin-app.mjs','text/javascript; charset=utf-8'],'/admin/assets/admin.css':['admin.css','text/css; charset=utf-8'],'/app/assets/app.js':['user-app.mjs','text/javascript; charset=utf-8'],'/app/assets/app.css':['user-app.css','text/css; charset=utf-8'],'/downloads/voxi-openclaw.py':['voxi-openclaw.py','text/x-python; charset=utf-8']};
    assets['/shared/web-memory.js']=['web-memory-ui.mjs','text/javascript; charset=utf-8'];
    assets['/shared/connection-marks.svg']=['connection-marks.svg','image/svg+xml'];
    assets['/shared/theme.css']=['theme.css','text/css; charset=utf-8'];
    assets['/shared/login-page.js']=['login-page.mjs','text/javascript; charset=utf-8'];
    assets['/shared/radio-schematic.svg']=['radio-schematic.svg','image/svg+xml'];
    assets['/app/assets/context.js']=['user-context.mjs','text/javascript; charset=utf-8'];
    assets['/downloads/voxi-context-sync.py']=['voxi-context-sync.py','text/x-python; charset=utf-8'];
    assets['/downloads/voxi-muse-code.mjs']=['voxi-muse-code.mjs','text/javascript; charset=utf-8'];
    if(assets[path]){const [file,type]=assets[path];res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(readFileSync(new URL('./'+file,import.meta.url)));return;}
    if(['/app','/app/','/app/profile','/app/channels','/app/connections','/app/context','/app/tasks','/app/account'].includes(path)){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(readFileSync(new URL('./user.html',import.meta.url)));return;
    }
    if(path==='/admin/ai/prompts'){
      res.writeHead(302,{'Location':'/admin/agent#assistant-behavior','Cache-Control':'no-store'});res.end();return;
    }
    if(path==='/admin/agent/tasks'){
      res.writeHead(302,{'Location':'/admin/users','Cache-Control':'no-store'});res.end();return;
    }
    if(path==='/admin/connections'||path==='/admin/connections/'){
      res.writeHead(302,{'Location':'/admin/agent','Cache-Control':'no-store'});res.end();return;
    }
    if(['/admin','/admin/','/admin/overview','/admin/devices','/admin/users','/admin/ai/voice','/admin/agent','/admin/agent/credentials','/admin/events','/admin/account'].includes(path)||/^\/admin\/devices\/esp32-[a-f0-9]{12}\/memory$/.test(path)||/^\/admin\/users\/[a-f0-9]{32}(?:\/(?:profile|devices|memory|tasks))?\/?$/.test(path)){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
      res.end(readFileSync(new URL('./admin.html',import.meta.url)));return;
    }
    if(req.url==='/setup/'||req.url==='/setup'){
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});
      res.end(readFileSync(new URL('./setup.html',import.meta.url)));return;
    }
    if(req.url!=='/healthz'){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,mode,revision,downlinkFormat:OPUS_FORMAT,opusOnly:true,audioBitrate:OPUS_BITRATE}));
  });
  server.once('close',()=>{webMemory?.close();users.close();admin.close();});
  const wss=new WebSocketServer({server,maxPayload:8192});
  let connectionSequence=0;
  let pendingAdmissions=0;
  const connected=new Map();
  const pocketOverview=mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'overview'):null;
  const admin=createAdmin({username:adminUsername,passwordHash:adminPasswordHash,accountFile:adminStateFile?adminStateFile+'.account':undefined,token:adminToken,
    voicePreview:mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'voice-preview'):undefined,
    userAccounts:users.admin,
    userDetail:users.detail,
    userWebMemory:webMemory?async(userId,body)=>{
      await users.detail(userId,'profile');
      return webMemory.manage(userId,body);
    }:undefined,
    deviceRegistry:mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa},'devices'):undefined,
    memoryConfiguration:pocketMemory?body=>{
      if(body?.action==='rebind'&&!users.enabled(body.userId))throw Error('接收方必须先开通并启用网页登录账户');
      return webMemory?webMemory.forward(pocketMemory,body,body?.userId):pocketMemory(body);
    }:undefined,
    aiConfiguration:mode==='pocket'?pocketSettings({url:pocketUrl,token:pocketToken,ca:pocketCa}):undefined,
    agentConfiguration:webMemory?body=>webMemory.forward(pocketAgent,body,body?.userId):pocketAgent,
    snapshot:()=>({mode,revision,devices:[...connected.values()].filter(d=>d.device.readyState===WebSocket.OPEN).map(d=>d.snapshot())}),
    overview:async()=>{
      const local={accounts:users.accountCount()};
      if(!pocketOverview)return {...local,cloud:null,cloudStatus:'disabled'};
      try{return {...local,cloud:await pocketOverview(),cloudStatus:'ready'};}
      catch{return {...local,cloud:null,cloudStatus:'unavailable'};}
    },
    disconnect:id=>{const d=connected.get(id);if(!d||d.device.readyState!==WebSocket.OPEN)return false;d.device.closeOrigin='admin_disconnected';d.device.close(1000,'Disconnected by administrator');const timer=setTimeout(()=>d.device.terminate(),1500);timer.unref();d.device.once('close',()=>clearTimeout(timer));return true;}
  });
  wss.on('connection',async(device,req)=>{
    const codecs=String(req.headers['x-voxi-downlink-codecs']||'').split(',').map(s=>s.trim());
    const audioFormat=mode==='pocket'&&codecs.includes(OPUS_BATCH_FORMAT)?OPUS_BATCH_FORMAT:OPUS_FORMAT;
    const deviceId=/^esp32-[a-f0-9]{12}$/.test(req.headers['x-voxi-device-id']||'')?req.headers['x-voxi-device-id']:null;
    const connection=++connectionSequence;let inputBytes=0;
    let observedChannel=null,observedBusy=false;
    const openedAt=Date.now();let sentPings=0,pongs=0,pings=0,lastPongAt=openedAt,lastPingAt=0;
    const connectionMetrics=()=>({ageMs:Date.now()-openedAt,sentPings,pongs,pings,lastPongAgoMs:Date.now()-lastPongAt,lastPingAgoMs:lastPingAt?Date.now()-lastPingAt:null,queuedPcmBytes:device.downlinkQueuedBytes?.()??0,tcpBufferedBytes:device.bufferedAmount});
    // ws emits 'error' for malformed frames. Handle it before authentication
    // so one bad/disconnected client cannot terminate the whole gateway.
    device.on('error',error=>console.error(JSON.stringify({event:'device_ws_error',connection,code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'OTHER'})));
    device.on('message',(raw,binary)=>{
      if(!device.authenticated)return;
      device.isAlive=true;
      if(binary){inputBytes+=raw.length;return;}
      let control;try{control=JSON.parse(raw);}catch{return;}
      if(control?.type==='channel'&&Number.isInteger(control.channel)&&control.channel>=0&&control.channel<(mode==='pocket'?16:channels.length))observedChannel=control.channel;
      if(control?.type==='ptt_down')observedBusy=true;if(control?.type==='ptt_up')observedBusy=false;
      if(['ptt_down','ptt_up'].includes(control?.type))console.log(JSON.stringify({event:'device_ptt',connection,type:control.type,inputBytes}));
    });
    device.on('close',(code)=>{connected.delete(connection);const event={event:'device_closed',connection,code,inputBytes,origin:device.closeOrigin||'peer_or_transport',...connectionMetrics()};if(device.authenticated)admin.record(event);console.log(JSON.stringify(event));});

    const authorization=req.headers.authorization||'',legacy=authorization===`Bearer ${token}`;
    const deviceKey=requireDeviceEnrollment&&/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)?authorization.slice(7):null;
    if(req.url!=='/radio'||(!legacy&&!deviceKey)){device.closeOrigin='auth_rejected';admin.record({event:'device_rejected',connection,reason:'unauthorized'});console.warn(JSON.stringify({event:'device_rejected',connection,reason:'unauthorized'}));device.send(JSON.stringify({type:'error',message:'Device token rejected; check saved gateway token'}));device.close(1008,'Unauthorized');return;}
    if(req.headers['x-voxi-audio-format']!==OPUS_FORMAT){
      device.closeOrigin='codec_required';
      device.send(JSON.stringify({type:'error',message:'Opus firmware required; update device firmware',code:'opus_required'}));
      device.close(1008,'Opus firmware required');return;
    }
    let ownerId,deviceProof;
    if(requireDeviceEnrollment){
      const reject=(code,message)=>{
        if(device.readyState!==WebSocket.OPEN)return;
        device.closeOrigin='enrollment_rejected';device.send(JSON.stringify({type:'error',code:'device_enrollment_required',message}));
        device.close(code,'Device enrollment required');
      };
      if(!deviceId){reject(1008,'设备需要唯一 ID，请升级固件并联系管理员登记');return;}
      if(pendingAdmissions>=32){reject(1013,'设备登记服务繁忙，请稍后重试');return;}
      deviceProof=legacy?'legacy':createHash('sha256').update(deviceKey).digest('hex');
      const controller=new AbortController();const cancel=()=>controller.abort();device.once('close',cancel);
      pendingAdmissions++;
      try{({userId:ownerId}=await pocketMemory({action:'device_admission',deviceId,proof:deviceProof},{signal:controller.signal}));}
      catch{reject(1008,'设备未登记、已退役或设备令牌不匹配');return;}
      finally{pendingAdmissions--;device.off('close',cancel);}
      if(device.readyState!==WebSocket.OPEN)return;
      if(!users.enabled(ownerId)){reject(1008,'设备所属用户尚未注册或账户已停用');return;}
    }
    device.authenticated=true;
    const cellular=req.headers['x-voxi-link']==='cellular-v1';
    connected.set(connection,{device,ownerId,snapshot:()=>({connection,deviceId,audioFormat,channelName:device.voxiChannelName||null,channelMode:device.voxiChannelMode||null,channel:observedChannel,busy:Boolean(device.radioBusy||observedBusy),inputBytes,...connectionMetrics()})});
    admin.record({event:'device_opened',connection});
    device.isAlive=true;device.on('pong',()=>{device.isAlive=true;pongs++;lastPongAt=Date.now();});device.on('ping',()=>{device.isAlive=true;pings++;lastPingAt=Date.now();});
    if(cellular)device.on('message',()=>{device.isAlive=true;});
    console.log(JSON.stringify({event:'device_opened',connection}));
    let missedHeartbeats=0;
    const heartbeat=setInterval(()=>{
      missedHeartbeats=device.isAlive?0:missedHeartbeats+1;
      if(missedHeartbeats>=(cellular?2:1)){device.closeOrigin='heartbeat_timeout';console.warn(JSON.stringify({event:'device_heartbeat_timeout',connection,...connectionMetrics()}));device.terminate();return;}
      device.isAlive=false;sentPings++;device.ping();
    },30000);
    // A stale idle session must not keep a paid model connection forever.
    const lifetime=setInterval(()=>{
      if(!rotateSession(mode,device.radioBusy,req.headers['x-voxi-standby']))return;
      device.closeOrigin='session_rotation';device.close(1000,'Session rotation');
    },30*60*1000);
    if(mode==='pocket'){
      attachPocket(device,{url:pocketUrl,token:pocketToken,ca:pocketCa,deviceId,ownerId,deviceProof,connection,audioFormat,
        extendedChannels:req.headers['x-voxi-channels']==='blocks-v1',cellular});
      device.on('close',()=>{clearInterval(heartbeat);clearInterval(lifetime);});
      return;
    }
    let upstream,channel=0,ready=false,recording=false,bytes=0,epoch=0,timer,deadline,turn=0,responseId=null;
    const uplink=new UplinkDecoder();uplink.reset();device.on('close',()=>uplink.close());
    let item=null,playedMs=0,responding=false,acceptOutput=false,filter=new RadioFilter(),released=0,first=true;
    let queued=Buffer.alloc(0),pump,sourceDone=false;
    const opus=new OpusDownlink();
    const send=o=>{
      if(device.readyState!==1)return;
      if(o.type==='ready')o={...o,audioFormat,audioBitrate:OPUS_BITRATE,uplinkFormat:UPLINK_FORMAT};
      if(o.type==='audio_start')opus.reset();
      if(o.type==='audio_end')for(const packet of opus.finish())device.send(packet,{binary:true});
      if(['flush','error','offline'].includes(o.type))opus.close();
      device.send(JSON.stringify(o));
    };
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
          if(device.readyState===1){try{for(const packet of opus.audio(frame))device.send(packet,{binary:true});}catch{return fail('Opus audio encoding failed');}}
        }else if(sourceDone){clearInterval(pump);pump=null;acceptOutput=false;send({type:'audio_end'});}
      },20);
    }
    device.on('message',(raw,binary)=>{
      if(binary){
        if(!recording||!ready)return;
        try{raw=uplink.audio(raw);}catch(e){return fail(e.message);}
        bytes+=raw.length;
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
      else if(e.type==='ptt_down'&&ready&&!recording){try{uplink.reset(e.audioFormat);}catch(err){return fail(err.message);}interrupt();filter=new RadioFilter();api({type:'input_audio_buffer.clear'});recording=true;bytes=0;send({type:'recording'});}
      else if(e.type==='ptt_up'&&recording){
        try{uplink.finish();}catch(err){return fail(err.message);}
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
    device.on('close',()=>{epoch++;clearInterval(heartbeat);clearInterval(lifetime);clearInterval(timer);clearInterval(pump);clearTimeout(deadline);opus.close();upstream?.close();});
    device.on('error',()=>{});
    connect();
  });
  return {server,wss};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {server,wss}=createGateway({mode:process.env.MODE||'mock',token:process.env.DEVICE_TOKEN,apiKey:process.env.OPENAI_API_KEY,model:process.env.OPENAI_MODEL,voice:process.env.OPENAI_VOICE,revision:process.env.REVISION||'dev',adminToken:process.env.ADMIN_TOKEN,adminUsername:process.env.ADMIN_USERNAME,adminPasswordHash:process.env.ADMIN_PASSWORD_HASH,adminStateFile:process.env.ADMIN_STATE_FILE,pocketUrl:process.env.POCKET_URL,pocketToken:process.env.POCKET_DEVICE_TOKEN,pocketCa:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined});
  server.listen(Number(process.env.PORT||8787),'0.0.0.0',()=>console.log('Radio gateway listening'));
  process.on('SIGTERM',()=>{
    for(const client of wss.clients)client.close(1012,'Service restarting');
    server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),4000).unref();
  });
}
