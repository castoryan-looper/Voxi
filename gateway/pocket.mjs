import WebSocket from 'ws';
import {RadioFilter} from './radio.mjs';
import {PcmPacer} from './pcm-pacer.mjs';
import {OpusDownlink,OPUS_FORMAT,OPUS_BITRATE} from './opus.mjs';
import {OpusPacketBatcher,OPUS_BATCH_FORMAT} from './opus-batch.mjs';
import {UplinkDecoder,UPLINK_FORMAT} from './uplink.mjs';
import {DownlinkProbe} from './downlink-probe.mjs';

// Protocol-compatible proxy; only the Pocket device bearer crosses this link.
// No ChatGPT login files, account tokens or Docker socket are mounted in Voxi.
export function attachPocket(device,{url,token,ca,deviceId,connection,audioFormat=OPUS_FORMAT}) {
  if(![OPUS_FORMAT,OPUS_BATCH_FORMAT].includes(audioFormat))throw Error('Only Opus downlink is supported');
  const upstream=new WebSocket(url,{handshakeTimeout:10000,maxPayload:65536,
    headers:{Authorization:`Bearer ${token}`,...(deviceId?{'X-Voxi-Device-Id':deviceId}:{})},...(ca?{ca}:{})});
  let ready=false,recording=false,bytes=0,filter=new RadioFilter(),failed=false,lastReady=null;
  const uplink=new UplinkDecoder();uplink.reset();
  let replyNumber=0,reply=null;
  const opus=new OpusDownlink();
  const finishReply=outcome=>{
    if(!reply)return;
    const {lastSourceAt,lastSendAt,startedAt,...metrics}=reply;
    console.log(JSON.stringify({event:'pocket_downlink',connection,reply:replyNumber,outcome,audioFormat,
      elapsedMs:Math.round(performance.now()-startedAt),...pacer.metrics(),...metrics}));
    reply=null;
  };
  const error=message=>{
    if(failed)return;failed=true;probe.stop();batcher.clear();finishReply("relay_error");pacer.clear();
    console.error(JSON.stringify({event:'pocket_relay_error',reason:message,inputBytes:bytes}));
    if(device.readyState===1){device.closeOrigin='pocket_error';device.send(JSON.stringify({type:'error',message}));device.close(1011,'Pocket backend unavailable');}
    upstream.close();
  };
  const sendWire=(data,binary)=>{
    if(device.readyState!==1)return;
    device.send(data,{binary});
    if(binary&&reply){
      const now=performance.now();
      if(reply.lastSendAt!==null)reply.maxSendGapMs=Math.max(reply.maxSendGapMs,Math.round(now-reply.lastSendAt));
      reply.lastSendAt=now;reply.sentBytes+=data.length;reply.sentMessages++;
    }
  };
  const batcher=new OpusPacketBatcher({send:packet=>sendWire(packet,true),enabled:audioFormat===OPUS_BATCH_FORMAT});
  const deliver=(data,binary)=>{
    if(device.readyState!==1)return;
    try{
      if(binary){
        for(const packet of opus.audio(data))batcher.add(packet);
        return;
      }
      const e=JSON.parse(data);
      if(e.type==='ready'){e.audioFormat=audioFormat;e.audioBitrate=OPUS_BITRATE;e.uplinkFormat=UPLINK_FORMAT;e.downlinkProbe=true;}
      if(e.type==='audio_start'){batcher.clear();opus.reset();pacer.beginStream(e.flowId);}
      if(e.type==='audio_end'){for(const packet of opus.finish())batcher.add(packet);batcher.flush();}
      if(['flush','connecting','offline','error'].includes(e.type)){batcher.clear();opus.close();}
      if(['busy','thinking','audio_start'].includes(e.type))device.radioBusy=true;
      if(['ready','audio_end','idle','error','offline'].includes(e.type))device.radioBusy=false;
      sendWire(JSON.stringify(e),false);
      if(e.type==='audio_end')finishReply('complete');
    }catch{error('Downlink audio encoding failed');}
  };
  const pacer=new PcmPacer({send:deliver,fail:error,maxCreditBytes:120*48000,maxAheadMs:11000,
    onCreditStall:metrics=>console.log(JSON.stringify({event:'pocket_credit_stall',connection,reply:replyNumber,...metrics})),
    canSend:()=>{
      if(reply)reply.peakTcpBufferedBytes=Math.max(reply.peakTcpBufferedBytes,device.bufferedAmount);
      return device.readyState===1&&device.bufferedAmount<4800;
    }});
  device.downlinkQueuedBytes=()=>pacer.bytes;
  const beginReply=(e,source='voice')=>{
    finishReply('replaced');replyNumber++;e.flowId=String(replyNumber);
    reply={source,startedAt:performance.now(),lastSourceAt:null,lastSendAt:null,sourcePcmBytes:0,sentBytes:0,sentMessages:0,
      maxSourceGapMs:0,maxSendGapMs:0,peakQueuedPcmBytes:0,peakTcpBufferedBytes:0};
    filter=new RadioFilter();pacer.control(JSON.stringify(e));
  };
  const acceptPcm=raw=>{
    if(reply){const now=performance.now();if(reply.lastSourceAt!==null)reply.maxSourceGapMs=Math.max(reply.maxSourceGapMs,Math.round(now-reply.lastSourceAt));reply.lastSourceAt=now;reply.sourcePcmBytes+=raw.length;}
    pacer.audio(filter.process(raw));
    if(reply)reply.peakQueuedPcmBytes=Math.max(reply.peakQueuedPcmBytes,pacer.bytes);
  };
  const probe=new DownlinkProbe({audio:acceptPcm,end:()=>{
    pacer.control(JSON.stringify({type:'audio_end'}));
    pacer.control(JSON.stringify({...lastReady,type:'ready'}));
  }});
  const cancelProbe=reason=>{
    if(!probe.active&&reply?.source!=='transport_probe')return false;
    probe.stop();finishReply(reason);batcher.clear();pacer.clear();opus.close();
    deliver(JSON.stringify({type:'flush'}),false);return true;
  };
  const pacing=setInterval(()=>{probe.tick();pacer.tick();batcher.tick();},5);
  upstream.on('message',(raw,binary)=>{
    if(device.readyState!==1)return;
    if(binary){
      if(!ready||recording||probe.active)return;
      if(raw.length%2)return error('Pocket returned invalid PCM');
      acceptPcm(raw);
    }else{
      let e;try{e=JSON.parse(raw);}catch{return error('Pocket returned invalid control data');}
      if(!e||typeof e!=='object')return error('Pocket returned invalid event');
      if(e.type==='ready'){ready=true;lastReady={...e};}
      if(['connecting','offline','error'].includes(e.type)){ready=false;recording=false;}
      if(['audio_start','flush','connecting','offline','error'].includes(e.type))cancelProbe('upstream_interrupted');
      if(e.type==='flush')filter=new RadioFilter();
      if(e.type==='audio_start'){
        beginReply(e);return;
      }
      if(['flush','connecting','offline','error'].includes(e.type)){batcher.clear();finishReply(e.type);pacer.clear();}
      pacer.control(JSON.stringify(e));
    }
  });
  device.on('message',(raw,binary)=>{
    if(upstream.readyState!==1)return;
    if(upstream.bufferedAmount>96000)return error('Pocket upload network too slow');
    if(binary){
      if(!ready||!recording)return;
      let pcm;try{pcm=uplink.audio(raw);}catch(e){return error(e.message);}
      bytes+=pcm.length;upstream.send(pcm,{binary:true});return;
    }
    let e;try{e=JSON.parse(raw);}catch{return;}
    if(!e||typeof e!=='object'||Array.isArray(e))return;
    if(e.type==='playback_credit'){pacer.feedback(e);return;}
    if(e.type==='downlink_probe'){
      if(!Number.isInteger(e.seconds)||e.seconds<1||e.seconds>180||!ready||recording||reply||device.radioBusy){
        sendWire(JSON.stringify({type:'probe_rejected',message:'Test requires idle READY and duration 1..180 seconds'}),false);return;
      }
      beginReply({type:'audio_start',source:'transport_probe',seconds:e.seconds},'transport_probe');probe.start(e.seconds);return;
    }
    if(e.type==='downlink_probe_cancel'){
      if(cancelProbe('probe_cancelled'))deliver(JSON.stringify({...lastReady,type:'ready'}),false);
      return;
    }
    if(e.type==='ptt_down'||e.type==='channel')cancelProbe('probe_interrupted');
    if(e.type==='ptt_down'&&ready){try{uplink.reset(e.audioFormat);}catch(err){return error(err.message);}recording=true;bytes=0;device.radioBusy=true;}
    else if(e.type==='ptt_up'){
      if(recording){try{uplink.finish();}catch(err){return error(err.message);}
       console.log(JSON.stringify({event:'device_upload',connection,audioFormat:uplink.format,wireBytes:uplink.wireBytes,pcmBytes:uplink.pcmBytes,originalSamples:uplink.originalSamples}));}
      recording=false;
    }
    else if(e.type==='channel'){ready=false;recording=false;batcher.clear();finishReply("channel_change");pacer.clear();}
    if(['ptt_down','ptt_up','channel','played'].includes(e.type))upstream.send(JSON.stringify(e));
  });
  upstream.on('unexpected-response',(_,response)=>{
    const code=response.statusCode;
    console.error(JSON.stringify({event:'pocket_handshake_failed',status:code}));
    response.resume();upstream.terminate();
    error(code===503&&response.headers['x-voxi-rejection']==='session-limit'?'Pocket voice session capacity reached; wait for a free device slot':code===401||code===403?'Pocket authentication rejected (HTTP '+code+'); rerun connect-pocket.sh':code===404?'Pocket /voxi endpoint missing (HTTP 404); upgrade Pocket Cloud':'Pocket handshake failed (HTTP '+code+')');
  });
  upstream.on('error',e=>{
    if(failed)return;
    const labels={ENOTFOUND:'Pocket Docker hostname not found; check shared network',ECONNREFUSED:'Pocket voice port refused; check relay service on port 8789',ETIMEDOUT:'Pocket connection timed out',EHOSTUNREACH:'Pocket network unreachable',ECONNRESET:'Pocket connection reset'};
    console.error(JSON.stringify({event:'pocket_connection_failed',code:labels[e.code]?e.code:'OTHER'}));
    error(labels[e.code]||'Cannot connect to Pocket native voice; verify backend deployment and device bearer');
  });
  upstream.on('close',(code)=>{probe.stop();finishReply('pocket_closed');batcher.clear();pacer.clear();opus.close();console.log(JSON.stringify({event:'pocket_closed',code,inputBytes:bytes,failed}));if(device.readyState===1){device.closeOrigin='pocket_closed';device.send(JSON.stringify({type:'offline'}));device.close(1012,'Pocket disconnected');}});
  device.on('close',()=>{probe.stop();finishReply('device_closed');clearInterval(pacing);batcher.clear();pacer.clear();opus.close();uplink.close();upstream.close();});
  return upstream;
}
