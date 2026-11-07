// An absolute-clock, bounded source for repeatable transport/playback tests.
// No model call, microphone data, or unbounded pre-generated PCM is involved.
export class DownlinkProbe {
 constructor({audio,end,now=()=>performance.now()}){Object.assign(this,{audio,end,now});this.stop();}
 start(seconds){
  if(!Number.isInteger(seconds)||seconds<1||seconds>180)throw Error('Probe seconds must be 1..180');
  this.frame=0;this.total=seconds*50;this.startedAt=this.now();this.active=true;
 }
 stop(){this.active=false;}
 tick(){
  if(!this.active)return;
  const due=Math.min(this.total,Math.floor((this.now()-this.startedAt)/20));
  // At most 100ms source audio per tick if the event loop is late.
  for(let budget=0;this.active&&this.frame<due&&budget<5;budget++){
   const pcm=Buffer.alloc(960),offset=this.frame*480;
   for(let i=0;i<480;i++){
    const phase=(offset+i)%120000;
    const envelope=phase<4800?Math.max(0,Math.min(1,phase/240,(4799-phase)/240)):0;
    pcm.writeInt16LE(Math.round(800*envelope*Math.sin(2*Math.PI*440*(offset+i)/24000)),i*2);
   }
   this.frame++;this.audio(pcm);
  }
  if(this.active&&this.frame===this.total){this.active=false;this.end();}
 }
}
