import WebSocket from 'ws';
import {RadioFilter} from './radio.mjs';

// Protocol-compatible proxy; only the Pocket device bearer crosses this link.
// No ChatGPT login files, account tokens or Docker socket are mounted in Voxi.
export function attachPocket(device,{url,token,ca}) {
  const upstream=new WebSocket(url,{handshakeTimeout:10000,maxPayload:65536,
    headers:{Authorization:`Bearer ${token}`},...(ca?{ca}:{})});
  let ready=false,recording=false,bytes=0,filter=new RadioFilter();
  const error=message=>{
    if(device.readyState===1){device.send(JSON.stringify({type:'error',message}));device.close(1011,'Pocket backend unavailable');}
    upstream.close();
  };
  upstream.on('message',(raw,binary)=>{
    if(device.readyState!==1)return;
    if(device.bufferedAmount>48000)return error('Device playback network too slow');
    if(binary){
      if(!ready||recording)return;
      if(raw.length%2)return error('Pocket returned invalid PCM');
      const pcm=filter.process(raw);
      for(let i=0;i<pcm.length;i+=960)device.send(pcm.subarray(i,i+960));
    }else{
      let e;try{e=JSON.parse(raw);}catch{return error('Pocket returned invalid control data');}
      if(!e||typeof e!=='object')return error('Pocket returned invalid event');
      if(e.type==='ready')ready=true;
      if(['connecting','offline','error'].includes(e.type)){ready=false;recording=false;}
      if(e.type==='audio_start'||e.type==='flush')filter=new RadioFilter();
      device.send(raw.toString());
    }
  });
  device.on('message',(raw,binary)=>{
    if(upstream.readyState!==1)return;
    if(upstream.bufferedAmount>96000)return error('Pocket upload network too slow');
    if(binary){
      if(!ready||!recording)return;
      bytes+=raw.length;
      if(raw.length%2||bytes>30*48000)return error('Invalid/overlong PCM');
      upstream.send(raw,{binary:true});return;
    }
    let e;try{e=JSON.parse(raw);}catch{return;}
    if(!e||typeof e!=='object'||Array.isArray(e))return;
    if(e.type==='ptt_down'&&ready){recording=true;bytes=0;}
    else if(e.type==='ptt_up')recording=false;
    else if(e.type==='channel'){ready=false;recording=false;}
    if(['ptt_down','ptt_up','channel','played'].includes(e.type))upstream.send(JSON.stringify(e));
  });
  upstream.on('error',()=>error('Cannot connect to Pocket native voice; verify backend deployment and device bearer'));
  upstream.on('close',()=>{if(device.readyState===1){device.send(JSON.stringify({type:'offline'}));device.close(1012,'Pocket disconnected');}});
  device.on('close',()=>upstream.close());
  return upstream;
}
