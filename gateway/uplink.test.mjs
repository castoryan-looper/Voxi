import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OpusDownlink} from './opus.mjs';
import {UplinkDecoder,UPLINK_FORMAT} from './uplink.mjs';
function bundle(packets,sequence=0,valid=480){
 const chunks=[Buffer.from([sequence&255,(sequence>>>8)&255,(sequence>>>16)&255,(sequence>>>24)&255,packets.length])];
 for(const p of packets){const h=Buffer.alloc(4);h.writeUInt16LE(valid);h.writeUInt16LE(p.length-4,2);chunks.push(h,p.subarray(4));}
 return Buffer.concat(chunks);
}
test('uplink bundles decode ordered 16kbps speech with bounded original duration and tail',()=>{
 const enc=new OpusDownlink(16000),dec=new UplinkDecoder();
 try{
  enc.reset();dec.reset(UPLINK_FORMAT);const pcm=Buffer.alloc(96000);for(let i=0;i<48000;i++)pcm.writeInt16LE(Math.round(10000*Math.sin(i*2*Math.PI*500/24000)),i*2);
  const frames=enc.audio(pcm),output=[];
  for(let i=0;i<frames.length;i+=5)output.push(dec.audio(bundle(frames.slice(i,i+5),i)));
  assert.throws(()=>dec.finish(),/tail/);
  output.push(dec.audio(bundle(enc.finish(),frames.length,0)));dec.finish();
  assert.equal(dec.originalSamples,48000);assert.equal(dec.pcmBytes,96960);assert.ok(dec.wireBytes<4600);
  assert.ok(Buffer.concat(output).some(b=>b!==0));assert.throws(()=>dec.audio(bundle(frames.slice(0,1))),/sequence/);
  dec.reset(UPLINK_FORMAT);assert.equal(dec.sequence,0);
  dec.audio(bundle(frames.slice(0,1),0,123));dec.audio(bundle(frames.slice(1,2),1,0));dec.finish();assert.equal(dec.originalSamples,123);
 }finally{enc.close();dec.close();}
});
test('uplink rejects malformed bundles, duplicate sequences, duration overflow and unsupported formats',()=>{
 const enc=new OpusDownlink(16000),dec=new UplinkDecoder();enc.reset();const frames=enc.audio(Buffer.alloc(960));
 try{
  for(const raw of [Buffer.alloc(4),Buffer.from([0,0,0,0,0]),bundle(frames,1),Buffer.concat([bundle(frames),Buffer.alloc(1)])]){dec.reset(UPLINK_FORMAT);assert.throws(()=>dec.audio(raw));}
  dec.reset(UPLINK_FORMAT);dec.originalSamples=480000;assert.throws(()=>dec.audio(bundle(frames)),/overlong/);
  dec.reset();assert.equal(dec.audio(Buffer.alloc(960000)).length,960000);assert.throws(()=>dec.audio(Buffer.alloc(2)),/overlong/);
  assert.throws(()=>dec.reset('unknown'),/Unsupported/);
 }finally{enc.close();dec.close();}
});
