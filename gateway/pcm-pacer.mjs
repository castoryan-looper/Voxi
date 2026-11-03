// Bound pending audio, not total response duration. Never catch up by bursting.
export class PcmPacer {
  constructor({send,fail,now=()=>performance.now(),canSend=()=>true,maxBytes=30*48000}) {
    Object.assign(this,{send,fail,now,canSend,maxBytes});this.clear();
  }
  clear(){this.queue=[];this.bytes=0;this.nextAt=0;}
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
    const {pcm}=this.queue.shift();this.bytes-=pcm.length;
    this.send(pcm,true);this.nextAt=Math.max(this.nextAt,this.now()-5)+pcm.length/48;
    while(this.queue.length&&!this.queue[0].pcm)this.send(this.queue.shift().raw,false);
  }
}
