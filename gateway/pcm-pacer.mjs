// Bound pending audio. Legacy clients remain realtime-paced. Credit-capable
// clients may refill faster, with every byte in flight charged to their capacity.
export class PcmPacer {
  constructor({send,fail,now=()=>performance.now(),canSend=()=>true,maxBytes=30*48000,maxCreditBytes=maxBytes,feedbackTimeoutMs=60000,maxAheadMs=8000,onCreditStall=()=>{}}) {
    Object.assign(this,{send,fail,now,canSend,maxBytes,maxCreditBytes,feedbackTimeoutMs,maxAheadMs,onCreditStall});this.clear();
  }
  clear(){this.queue=[];this.bytes=0;this.controls=0;this.nextAt=0;this.flow=null;this.sentPcm=0;}
  beginStream(id){this.flow={id,consumed:0,limit:0,updatedAt:0,enabled:false,updates:0,peakOutstanding:0,maxFeedbackGapMs:0,windowBlockedChecks:0,windowBlockAt:null,windowBlockedMs:0,windowBlockedMaxMs:0,transportBlockedChecks:0,tickGapMaxMs:0,lastTickAt:this.now()};this.sentPcm=0;}
  feedback(e){
    const f=this.flow;
    if(!f||e.flowId!==f.id)return false;
    const {consumedBytes,capacityBytes}=e;
    if(!Number.isSafeInteger(consumedBytes)||consumedBytes<f.consumed||consumedBytes>this.sentPcm+1920||
       !Number.isSafeInteger(capacityBytes)||capacityBytes<96000||capacityBytes>576000)return false;
    f.consumed=Math.min(consumedBytes,this.sentPcm);
    // Never invent consumption. Charge all sent bytes, including in flight,
    // and leave >=1 second of the reported capacity for tail/control jitter.
    f.limit=Math.min(this.maxAheadMs*48,capacityBytes-48000);
    if(f.enabled)f.maxFeedbackGapMs=Math.max(f.maxFeedbackGapMs,this.now()-f.updatedAt);
    f.updatedAt=this.now();f.enabled=true;f.updates++;return true;
  }
  metrics(){
    const f=this.flow,active=f&&f.windowBlockAt!==null?Math.max(0,this.now()-f.windowBlockAt):0;
    return {creditEnabled:Boolean(f?.enabled),creditUpdates:f?.updates??0,creditLimitMs:(f?.limit??0)/48,creditPeakOutstandingMs:Math.ceil((f?.peakOutstanding??0)/48),creditMaxFeedbackGapMs:Math.round(f?.maxFeedbackGapMs??0),creditWindowBlockedChecks:f?.windowBlockedChecks??0,creditWindowBlockedMs:Math.round((f?.windowBlockedMs??0)+active),creditWindowBlockedMaxMs:Math.round(Math.max(f?.windowBlockedMaxMs??0,active)),transportBlockedChecks:f?.transportBlockedChecks??0,pacerTickGapMaxMs:Math.round(f?.tickGapMaxMs??0)};
  }
  endWindowBlock(){
    const f=this.flow;if(!f||f.windowBlockAt===null)return;
    const ms=Math.max(0,this.now()-f.windowBlockAt);f.windowBlockedMs+=ms;f.windowBlockedMaxMs=Math.max(f.windowBlockedMaxMs,ms);f.windowBlockAt=null;
    if(ms>=2000)this.onCreditStall({flowId:f.id,durationMs:Math.round(ms),limitMs:f.limit/48,sentPcmBytes:this.sentPcm,consumedAtStart:f.blockedConsumed,consumedAtEnd:f.consumed,feedbackUpdates:f.updates-f.blockedUpdates,lastFeedbackAgoMs:Math.round(this.now()-f.updatedAt),queuedPcmBytes:this.bytes});
  }
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
    if(!this.canSend()){this.endWindowBlock();if(this.flow)this.flow.transportBlockedChecks++;return;}
    while(this.queue.length&&!this.queue[0].pcm){this.controls--;this.send(this.queue.shift().raw,false);}
    if(!this.queue.length){this.endWindowBlock();return;}
    if(this.now()<this.nextAt)return;
    const f=this.flow;
    if(f?.enabled&&this.now()-f.updatedAt>this.feedbackTimeoutMs){f.maxFeedbackGapMs=Math.max(f.maxFeedbackGapMs,this.now()-f.updatedAt);this.fail('Playback feedback timed out');this.clear();return;}
    // Existing credit is an absolute capacity bound, not a timed lease.
    // Delayed ACKs must not suspend safe bytes that are still within that bound.
    if(f?.enabled&&this.sentPcm+this.queue[0].pcm.length-f.consumed>f.limit){
      f.windowBlockedChecks++;
      if(f.windowBlockAt===null){f.windowBlockAt=this.now();f.blockedConsumed=f.consumed;f.blockedUpdates=f.updates;}
      return;
    }
    this.endWindowBlock();
    const {pcm}=this.queue.shift();this.bytes-=pcm.length;
    this.sentPcm+=pcm.length;
    if(f?.enabled)f.peakOutstanding=Math.max(f.peakOutstanding,this.sentPcm-f.consumed);
    this.send(pcm,true);this.nextAt=Math.max(this.nextAt,this.now()-5)+pcm.length/(this.flow?.enabled?96:48);
    while(this.queue.length&&!this.queue[0].pcm){this.controls--;this.send(this.queue.shift().raw,false);}
  }
}
