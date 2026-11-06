// Bound pending audio. Legacy clients remain realtime-paced. Credit-capable
// clients may refill faster, with every byte in flight charged to their capacity.
export class PcmPacer {
  constructor({send,fail,now=()=>performance.now(),canSend=()=>true,maxBytes=30*48000}) {
    Object.assign(this,{send,fail,now,canSend,maxBytes});this.clear();
  }
  clear(){this.queue=[];this.bytes=0;this.nextAt=0;this.flow=null;this.sentPcm=0;}
  beginStream(id){this.flow={id,consumed:0,limit:0,updatedAt:0,enabled:false,updates:0,peakOutstanding:0};this.sentPcm=0;}
  feedback(e){
    const f=this.flow;
    if(!f||e.flowId!==f.id)return false;
    const {consumedBytes,capacityBytes}=e;
    if(!Number.isSafeInteger(consumedBytes)||consumedBytes<f.consumed||consumedBytes>this.sentPcm+1920||
       !Number.isSafeInteger(capacityBytes)||capacityBytes<96000||capacityBytes>576000)return false;
    f.consumed=Math.min(consumedBytes,this.sentPcm);
    // Leave >=1 second for codec tail/control jitter. Max lookahead is 8s.
    f.limit=Math.min(8*48000,capacityBytes-48000);
    f.updatedAt=this.now();f.enabled=true;f.updates++;return true;
  }
  metrics(){return {creditEnabled:Boolean(this.flow?.enabled),creditUpdates:this.flow?.updates??0,creditPeakOutstandingMs:Math.ceil((this.flow?.peakOutstanding??0)/48)};}
  audio(pcm){
    if(this.bytes+pcm.length>this.maxBytes){this.clear();this.fail('Device audio backlog exceeded 30 seconds');return;}
    for(let i=0;i<pcm.length;i+=960)this.queue.push({pcm:pcm.subarray(i,i+960)});
    this.bytes+=pcm.length;
  }
  control(raw){
    if(!this.queue.length)this.send(raw,false);
    else if(this.queue.length<4096)this.queue.push({raw});
    else this.fail('Device control backlog exceeded');
  }
  tick(){
    if(!this.canSend())return;
    while(this.queue.length&&!this.queue[0].pcm)this.send(this.queue.shift().raw,false);
    if(!this.queue.length||this.now()<this.nextAt)return;
    const f=this.flow;
    if(f?.enabled&&this.now()-f.updatedAt>15000){this.clear();this.fail('Playback feedback timed out');return;}
    if(f?.enabled&&(this.now()-f.updatedAt>6000||this.sentPcm+this.queue[0].pcm.length-f.consumed>f.limit))return;
    const {pcm}=this.queue.shift();this.bytes-=pcm.length;
    this.sentPcm+=pcm.length;
    if(f?.enabled)f.peakOutstanding=Math.max(f.peakOutstanding,this.sentPcm-f.consumed);
    this.send(pcm,true);this.nextAt=Math.max(this.nextAt,this.now()-5)+pcm.length/(this.flow?.enabled?96:48);
    while(this.queue.length&&!this.queue[0].pcm)this.send(this.queue.shift().raw,false);
  }
}
