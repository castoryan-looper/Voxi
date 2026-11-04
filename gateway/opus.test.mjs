import {test} from 'node:test';
import assert from 'node:assert/strict';
import OpusScript from 'opusscript';
import {OpusDownlink} from './opus.mjs';

test('Opus CBR is 16kbps, ordered, decodable and preserves the final codec tail',()=>{
 const encoder=new OpusDownlink(),decoder=new OpusScript(24000,1,OpusScript.Application.VOIP);
 try{
  encoder.reset();const pcm=Buffer.alloc(24000*2);
  for(let n=0;n<24000;n++)pcm.writeInt16LE(Math.round(10000*Math.sin(n*2*Math.PI*440/24000)),n*2);
  const packets=[];
  // Deliberately split samples across frame-sized chunks, but never split a sample.
  for(let i=0;i<pcm.length;i+=314)packets.push(...encoder.audio(pcm.subarray(i,i+314)));
  assert.equal(packets.length,50);
  assert.equal(packets.reduce((n,p)=>n+p.length,0),2200); // 2000 payload + 200 sequence bytes / second.
  packets.push(...encoder.finish());assert.equal(packets.length,51);
  const decoded=packets.map((packet,i)=>{assert.equal(packet.readUInt32LE(),i);assert.equal(packet.length,44);const frame=decoder.decode(packet.subarray(4));assert.equal(frame.length,960);return frame;});
  const samples=Buffer.concat(decoded);let energy=0;for(let n=1000;n<20000;n++){const v=samples.readInt16LE(n*2);energy+=v*v;}
  assert.ok(Math.sqrt(energy/19000)>3000,'decoded speech signal must not become silence');
  assert.ok(decoded.at(-1).some(b=>b!==0),'flush must emit delayed last-frame audio');
  assert.deepEqual(encoder.finish(),[]);
 }finally{encoder.close();decoder.delete();}
});

test('partial final frames are padded and codec state/sequence resets between turns',()=>{
 const encoder=new OpusDownlink();
 try{
  assert.throws(()=>encoder.audio(Buffer.alloc(2)),/before audio_start/);
  encoder.reset();assert.deepEqual(encoder.finish(),[]);
  assert.deepEqual(encoder.audio(Buffer.alloc(100)),[]);
  const tail=encoder.finish();assert.equal(tail.length,2);assert.equal(tail[0].readUInt32LE(),0);assert.equal(tail[1].readUInt32LE(),1);
  encoder.reset();const fresh=encoder.audio(Buffer.alloc(960));assert.equal(fresh[0].readUInt32LE(),0);
  assert.throws(()=>encoder.audio(Buffer.alloc(3)),/Incomplete/);
 }finally{encoder.close();}
});
