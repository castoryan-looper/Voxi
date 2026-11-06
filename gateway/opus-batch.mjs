export const OPUS_BATCH_FORMAT='opus-24000-batch-v1';

// Keep the codec's 20ms sequence-numbered frames. Only coalesce transport
// messages, with a bounded hold time even when the source stops mid-batch.
export class OpusPacketBatcher {
  constructor({send,enabled=false,now=()=>performance.now(),maxHoldMs=40}){
    Object.assign(this,{send,enabled,now,maxHoldMs});this.clear();
  }
  clear(){this.pending=[];this.since=0;}
  add(packet){
    if(!this.enabled){this.send(packet);return;}
    if(packet.length<5||packet.length>1279)throw Error('Invalid Opus frame length');
    if(!this.pending.length)this.since=this.now();
    this.pending.push(packet);
    if(this.pending.length===3)this.flush();
  }
  tick(){if(this.pending.length&&this.now()-this.since>=this.maxHoldMs)this.flush();}
  flush(){
    if(!this.pending.length)return;
    const wire=Buffer.alloc(1+this.pending.reduce((n,p)=>n+2+p.length,0));
    wire[0]=this.pending.length;let offset=1;
    for(const packet of this.pending){wire.writeUInt16LE(packet.length,offset);packet.copy(wire,offset+2);offset+=2+packet.length;}
    this.clear();this.send(wire);
  }
}
