import OpusScript from 'opusscript';

export const OPUS_FORMAT='opus-24000-v1';
export const OPUS_BITRATE=24000;
export const OPUS_SAMPLES=480; // 20 ms, mono, 24 kHz; one packet per WebSocket message.

export class OpusDownlink {
  constructor(){this.codec=null;this.pending=Buffer.alloc(0);this.sequence=0;this.hasAudio=false;}
  reset(){
    this.close();
    this.codec=new OpusScript(24000,1,OpusScript.Application.VOIP);
    this.codec.setBitrate(OPUS_BITRATE);
    this.codec.encoderCTL(4006,0); // OPUS_SET_VBR: bounded 24 kbps CBR.
    this.codec.encoderCTL(4010,5); // OPUS_SET_COMPLEXITY.
  }
  packet(pcm){
    const payload=this.codec.encode(pcm,OPUS_SAMPLES);
    const wire=Buffer.alloc(4+payload.length);
    wire.writeUInt32LE(this.sequence++,0);payload.copy(wire,4);
    return wire;
  }
  audio(pcm){
    if(!this.codec)throw Error('Opus audio arrived before audio_start');
    if(pcm.length%2)throw Error('Incomplete PCM sample');
    if(pcm.length)this.hasAudio=true;
    this.pending=Buffer.concat([this.pending,pcm]);
    const packets=[];
    while(this.pending.length>=960){packets.push(this.packet(this.pending.subarray(0,960)));this.pending=this.pending.subarray(960);}
    return packets;
  }
  finish(){
    const packets=[];
    if(this.pending.length){const tail=Buffer.alloc(960);this.pending.copy(tail);packets.push(this.packet(tail));}
    // Drain codec lookahead so the last syllable is preserved. Padding adds
    // at most 40 ms; never trim delayed content from a partial final frame.
    if(this.hasAudio)packets.push(this.packet(Buffer.alloc(960)));
    this.pending=Buffer.alloc(0);this.hasAudio=false;
    return packets;
  }
  close(){if(this.codec){this.codec.delete();this.codec=null;}this.pending=Buffer.alloc(0);this.sequence=0;this.hasAudio=false;}
}
