// Bound pending audio. Legacy clients remain realtime-paced. Credit-capable
// clients may refill faster, with every byte in flight charged to their capacity.
export class PcmPacer {
  constructor({send,fail,now=()=>performance.now(),canSend=()=>true,maxBytes=30*48000,maxCreditBytes=maxBytes,feedbackTimeoutMs=60000}) {
    Object.assign(this,{send,fail,now,canSend,maxBytes,maxCreditBytes,feedbackTimeoutMs});this.clear();
  }
  clear(){this.queue=[];this.bytes=0;this.controls=0;this.nextAt=0;this.flow=null;this.sentPcm=0;}
  beginStream(id){this.flow={id,consumed:0,limit:0,updatedAt:0,enabled:false,updates:0,peakOutstanding:0,maxFeedbackGapMs:0,windowBlockedChecks:0,transportBlockedChecks:0,tickGapMaxMs:0,lastTickAt:this.now()};this.sentPcm=0;}
  feedback(e){
    const f=this.flow;
    if(!f||e.flowId!==f.id)return false;
    const {consumedBytes,capacityBytes}=e;
    if(!Number.isSafeInteger(consumedBytes)||consumedBytes<f.consumed||consumedBytes>this.sentPcm+1920||
       !Number.isSafeInteger(capacityBytes)||capacityBytes<96000||capacityBytes>576000)return false;
    f.consumed=Math.min(consumedBytes,this.sentPcm);
    // Leave >=1 second for codec tail/control jitter. Max lookahead is 8s.
    f.limit=Math.min(8*48000,capacityBytes-48000);
    if(f.enabled)f.maxFeedbackGapMs=Math.max(f.maxFeedbackGapMs,this.now()-f.updatedAt);
    f.updatedAt=this.now();f.enabled=true;f.updates++;return true;
  }
  metrics(){return {creditEnabled:Boolean(this.flow?.enabled),creditUpdates:this.flow?.updates??0,creditPeakOutstandingMs:Math.ceil((this.flow?.peakOutstanding??0)/48),creditMaxFeedbackGapMs:Math.round(this.flow?.maxFeedbackGapMs??0),creditWindowBlockedChecks:this.flow?.windowBlockedChecks??0,transportBlockedChecks:this.flow?.transportBlockedChecks??0,pacerTickGapMaxMs:Math.round(this.flow?.tickGapMaxMs??0)};}
  audio(pcm){
    const limit=this.flow?.enabled?this.maxCreditBytes:this.maxBytes;
    if(this.bytes+pcm.length>limit){this.clear();this.fail('Device audio backlog exceeded '+Math.round(limit/48000)+' seconds');return;}
    for(let i=0;i<pcm.length;i+=960)this.queue.push({pcm:pcm.subarray(i,i+960)});
    this.bytes+=pcm.length;
  }
  control(raw){
    if(!this.queue.length)this.send(raw,false);
    else if(this.controls<64){this.queue.push({raw});this.controls++;}
    else this.fail('Device control backlog exceeded');
  }
  tick(){
    if(this.flow){const at=this.now();this.flow.tickGapMaxMs=Math.max(this.flow.tickGapMaxMs,at-this.flow.lastTickAt);this.flow.lastTickAt=at;}
    if(!this.canSend()){if(this.flow)this.flow.transportBlockedChecks++;return;}
    while(this.queue.length&&!this.queue[0].pcm){this.controls--;this.send(this.queue.shift().raw,false);}
    if(!this.queue.length||this.now()<this.nextAt)return;
    const f=this.flow;
    if(f?.enabled&&this.now()-f.updatedAt>this.feedbackTimeoutMs){f.maxFeedbackGapMs=Math.max(f.maxFeedbackGapMs,this.now()-f.updatedAt);this.fail('Playback feedback timed out');this.clear();return;}
    // Existing credit is an absolute capacity bound, not a timed lease.
    // Delayed ACKs must not suspend safe bytes that are still within that bound.
    if(f?.enabled&&this.sentPcm+this.queue[0].pcm.length-f.consumed>f.limit){f.windowBlockedChecks++;return;}
    const {pcm}=this.queue.shift();this.bytes-=pcm.length;
    this.sentPcm+=pcm.length;
    if(f?.enabled)f.peakOutstanding=Math.max(f.peakOutstanding,this.sentPcm-f.consumed);
    this.send(pcm,true);this.nextAt=Math.max(this.nextAt,this.now()-5)+pcm.length/(this.flow?.enabled?96:48);
    while(this.queue.length&&!this.queue[0].pcm){this.controls--;this.send(this.queue.shift().raw,false);}
  }
}
