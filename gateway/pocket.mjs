import WebSocket from 'ws';
import {RadioFilter} from './radio.mjs';
import {PcmPacer} from './pcm-pacer.mjs';

// Protocol-compatible proxy; only the Pocket device bearer crosses this link.
// No ChatGPT login files, account tokens or Docker socket are mounted in Voxi.
export function attachPocket(device,{url,token,ca}) {
  const upstream=new WebSocket(url,{handshakeTimeout:10000,maxPayload:65536,
    headers:{Authorization:`Bearer ${token}`},...(ca?{ca}:{})});
  let ready=false,recording=false,bytes=0,filter=new RadioFilter(),failed=false;
  const error=message=>{
    if(failed)return;failed=true;pacer.clear();
    console.error(JSON.stringify({event:'pocket_relay_error',reason:message,inputBytes:bytes}));
    if(device.readyState===1){device.closeOrigin='pocket_error';device.send(JSON.stringify({type:'error',message}));device.close(1011,'Pocket backend unavailable');}
    upstream.close();
  };
  const deliver=(data,binary)=>{
    if(device.readyState!==1)return;
    if(!binary){const e=JSON.parse(data);
      if(['busy','thinking','audio_start'].includes(e.type))device.radioBusy=true;
      if(['ready','audio_end','idle','error','offline'].includes(e.type))device.radioBusy=false;
    }
    device.send(data,{binary});
  };
  const pacer=new PcmPacer({send:deliver,fail:error,
    canSend:()=>device.readyState===1&&device.bufferedAmount<4800});
  device.downlinkQueuedBytes=()=>pacer.bytes;
  const pacing=setInterval(()=>pacer.tick(),5);
  upstream.on('message',(raw,binary)=>{
    if(device.readyState!==1)return;
    if(binary){
      if(!ready||recording)return;
      if(raw.length%2)return error('Pocket returned invalid PCM');
      const pcm=filter.process(raw);
      pacer.audio(pcm);
    }else{
      let e;try{e=JSON.parse(raw);}catch{return error('Pocket returned invalid control data');}
      if(!e||typeof e!=='object')return error('Pocket returned invalid event');
      if(e.type==='ready')ready=true;
      if(['connecting','offline','error'].includes(e.type)){ready=false;recording=false;}
      if(e.type==='audio_start'||e.type==='flush')filter=new RadioFilter();
      if(['flush','connecting','offline','error'].includes(e.type))pacer.clear();
      pacer.control(raw.toString());
    }
  });
  device.on('message',(raw,binary)=>{
    if(upstream.readyState!==1)return;
    if(upstream.bufferedAmount>96000)return error('Pocket upload network too slow');
    if(binary){
      if(!ready||!recording)return;
      bytes+=raw.length;
      if(raw.length%2||bytes>20*48000)return error('Invalid/overlong PCM');
      upstream.send(raw,{binary:true});return;
    }
    let e;try{e=JSON.parse(raw);}catch{return;}
    if(!e||typeof e!=='object'||Array.isArray(e))return;
    if(e.type==='ptt_down'&&ready){recording=true;bytes=0;device.radioBusy=true;}
    else if(e.type==='ptt_up')recording=false;
    else if(e.type==='channel'){ready=false;recording=false;pacer.clear();}
    if(['ptt_down','ptt_up','channel','played'].includes(e.type))upstream.send(JSON.stringify(e));
  });
  upstream.on('unexpected-response',(_,response)=>{
    const code=response.statusCode;
    console.error(JSON.stringify({event:'pocket_handshake_failed',status:code}));
    response.resume();upstream.terminate();
    error(code===401||code===403?'Pocket authentication rejected (HTTP '+code+'); rerun connect-pocket.sh':code===404?'Pocket /voxi endpoint missing (HTTP 404); upgrade Pocket Cloud':'Pocket handshake failed (HTTP '+code+')');
  });
  upstream.on('error',e=>{
    if(failed)return;
    const labels={ENOTFOUND:'Pocket Docker hostname not found; check shared network',ECONNREFUSED:'Pocket voice port refused; check relay service on port 8789',ETIMEDOUT:'Pocket connection timed out',EHOSTUNREACH:'Pocket network unreachable',ECONNRESET:'Pocket connection reset'};
    console.error(JSON.stringify({event:'pocket_connection_failed',code:labels[e.code]?e.code:'OTHER'}));
    error(labels[e.code]||'Cannot connect to Pocket native voice; verify backend deployment and device bearer');
  });
  upstream.on('close',(code)=>{console.log(JSON.stringify({event:'pocket_closed',code,inputBytes:bytes,failed}));if(device.readyState===1){device.closeOrigin='pocket_closed';device.send(JSON.stringify({type:'offline'}));device.close(1012,'Pocket disconnected');}});
  device.on('close',()=>{clearInterval(pacing);pacer.clear();upstream.close();});
  return upstream;
}
