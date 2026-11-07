import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer,WebSocket} from 'ws';
import {createGateway} from './server.mjs';
import {OPUS_BATCH_FORMAT} from './opus-batch.mjs';

async function fixture(t){
 const seen=[],events=[],upstream=new WebSocketServer({port:0,host:'127.0.0.1'});
 await new Promise(r=>upstream.once('listening',r));
 upstream.on('connection',socket=>{socket.send(JSON.stringify({type:'ready',channel:0}));socket.on('message',(raw,binary)=>seen.push(binary?'binary':JSON.parse(raw)));});
 const {server,wss}=createGateway({mode:'pocket',token:'device',pocketToken:'backend',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
 const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device','X-Voxi-Audio-Format':'opus-24000-v1','X-Voxi-Downlink-Codecs':OPUS_BATCH_FORMAT}});
 const send=e=>device.send(JSON.stringify(e));
 device.on('message',(raw,binary)=>{
  const e=binary?{wire:raw}:JSON.parse(raw);events.push(e);
  if(e.type==='audio_start')send({type:'playback_credit',flowId:e.flowId,consumedBytes:0,capacityBytes:576000});
 });
 async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>4000)throw Error('Timed out');await new Promise(r=>setTimeout(r,3));}}
 await until(()=>events.some(e=>e.type==='ready'));assert.equal(events[0].downlinkProbe,true);
 return {events,seen,send,until};
}
test('authenticated fixed downlink probe preserves sequence/tail and never reaches the AI backend',async t=>{
 const f=await fixture(t);
 for(const seconds of [0,181,1.5])f.send({type:'downlink_probe',seconds});
 await f.until(()=>f.events.filter(e=>e.type==='probe_rejected').length===3);
 f.send({type:'downlink_probe',seconds:1});
 await f.until(()=>f.events.some(e=>e.type==='audio_start'));
 f.send({type:'downlink_probe',seconds:1});
 await f.until(()=>f.events.some(e=>e.type==='audio_end'));
 await f.until(()=>f.events.filter(e=>e.type==='ready').length===2);
 assert.equal(f.events.filter(e=>e.type==='probe_rejected').length,4);
 assert.equal(f.events.find(e=>e.type==='audio_start').source,'transport_probe');
 let frames=0;
 for(const {wire} of f.events.filter(e=>e.wire)){
  let at=1;for(let i=0;i<wire[0];i++){const n=wire.readUInt16LE(at);at+=2;assert.equal(wire.readUInt32LE(at),frames++);at+=n;}assert.equal(at,wire.length);
 }
 assert.equal(frames,51);assert.deepEqual(f.seen,[]);
 assert(f.events.findLastIndex(e=>e.wire)<f.events.findIndex(e=>e.type==='audio_end'));
});
test('cancel stops an active probe, flushes queued audio and restores idle readiness',async t=>{
 const f=await fixture(t);f.send({type:'downlink_probe',seconds:180});
 await f.until(()=>f.events.some(e=>e.wire));f.send({type:'downlink_probe_cancel'});
 await f.until(()=>f.events.some(e=>e.type==='flush'));
 await new Promise(r=>setTimeout(r,100));
 const at=f.events.findIndex(e=>e.type==='flush');
 assert(!f.events.slice(at).some(e=>e.wire));assert.equal(f.events.at(-1).type,'ready');assert.deepEqual(f.seen,[]);
});
