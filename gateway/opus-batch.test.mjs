import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OpusPacketBatcher} from './opus-batch.mjs';
import {OpusDownlink} from './opus.mjs';
import OpusScript from 'opusscript';

function unpack(wire){
 const frames=[];let at=1;
 for(let i=0;i<wire[0];i++){const n=wire.readUInt16LE(at);at+=2;frames.push(wire.subarray(at,at+n));at+=n;}
 assert.equal(at,wire.length);return frames;
}
test('three-frame batches preserve exact frames and final codec tail at every bitrate',()=>{
 for(const bitrate of [8000,12000,16000]){
  const encoder=new OpusDownlink(bitrate),decoder=new OpusScript(24000,1,OpusScript.Application.VOIP),sent=[];
  const b=new OpusPacketBatcher({enabled:true,send:p=>sent.push(p)});
  try{
   encoder.reset();const original=[...encoder.audio(Buffer.alloc(48000)),...encoder.finish()];
   for(const p of original)b.add(p);b.flush();
   assert.equal(sent.length,17);assert(sent.every(p=>p[0]===3));
   const frames=sent.flatMap(unpack);assert.deepEqual(frames,original);
   for(const [i,p] of frames.entries()){assert.equal(p.readUInt32LE(),i);assert.equal(decoder.decode(p.subarray(4)).length,960);}
  }finally{encoder.close();decoder.delete();}
 }
});
test('partial batches flush on bounded timeout and final drain, and clear discards interrupted audio',()=>{
 let now=0;const sent=[],b=new OpusPacketBatcher({enabled:true,now:()=>now,send:p=>sent.push(p)});
 const p=Buffer.from([0,0,0,0,42]);b.add(p);now=39;b.tick();assert.equal(sent.length,0);
 now=40;b.tick();assert.deepEqual(unpack(sent[0]),[p]);
 b.add(p);b.add(p);b.flush();assert.equal(sent[1][0],2);
 b.add(p);b.clear();now=1000;b.tick();b.flush();assert.equal(sent.length,2);
 b.add(p);b.add(p);b.add(p);assert.equal(sent[2][0],3);
});
test('legacy mode sends immediately without changing a byte',()=>{
 const sent=[],b=new OpusPacketBatcher({send:p=>sent.push(p)}),p=Buffer.from([0,0,0,0,42]);
 b.add(p);assert.deepEqual(sent,[p]);b.flush();assert.equal(sent.length,1);
});
