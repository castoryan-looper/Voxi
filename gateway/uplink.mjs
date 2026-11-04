import OpusScript from 'opusscript';
export const UPLINK_FORMAT='opus-24000-uplink-v1';
export class UplinkDecoder {
 constructor(){this.codec=null;this.format='pcm16-24000';}
 reset(format='pcm16-24000'){
  this.close();if(!['pcm16-24000',UPLINK_FORMAT].includes(format))throw Error('Unsupported microphone format');
  this.format=format;this.sequence=0;this.originalSamples=0;this.pcmBytes=0;this.wireBytes=0;this.ended=false;this.partial=false;
  if(format===UPLINK_FORMAT)this.codec=new OpusScript(24000,1,OpusScript.Application.VOIP);
 }
 audio(raw){
  if(this.format!==UPLINK_FORMAT){if(raw.length%2||this.pcmBytes+raw.length>960000)throw Error('Invalid/overlong PCM');this.pcmBytes+=raw.length;this.wireBytes+=raw.length;return raw;}
  if(!this.codec||this.ended||raw.length<5||raw.length>225||raw.readUInt32LE()!==this.sequence||raw[4]<1||raw[4]>5)throw Error('Invalid Opus uplink sequence/bundle');
  const frames=[];let at=5;
  for(let i=0;i<raw[4];i++){
   if(at+4>raw.length||this.ended)throw Error('Invalid Opus uplink frame');
   const valid=raw.readUInt16LE(at),length=raw.readUInt16LE(at+2);at+=4;
   if(length!==40||at+length>raw.length||valid>480||(this.partial&&valid!==0)||this.originalSamples+valid>480000)throw Error('Invalid/overlong Opus uplink');
   const pcm=this.codec.decode(raw.subarray(at,at+length));if(pcm.length!==960)throw Error('Unexpected Opus uplink duration');
   at+=length;this.originalSamples+=valid;this.partial=valid<480;this.ended=valid===0;this.sequence++;
   frames.push(pcm);
  }
  if(at!==raw.length)throw Error('Trailing Opus uplink data');
  const pcm=Buffer.concat(frames);this.pcmBytes+=pcm.length;this.wireBytes+=raw.length;return pcm;
 }
 finish(){if(this.format===UPLINK_FORMAT&&this.originalSamples&&!this.ended)throw Error('Opus uplink missing final codec tail');}
 close(){if(this.codec){this.codec.delete();this.codec=null;}}
}
