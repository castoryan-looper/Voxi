import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer,WebSocket} from 'ws';
import {createGateway} from './server.mjs';
import {OPUS_BITRATE} from './opus.mjs';
import {OPUS_BATCH_FORMAT} from './opus-batch.mjs';

for(const batched of [false,true]){
test(`Pocket proxy preserves PCM uplink and ordered ${batched?'batched':'legacy'} Opus downlink`,async t=>{
  const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>upstream.once('listening',r));
  const seen=[];const records=[];
  const catalog=[['快问','fast',''],['Voxi Agent','agent',''],['备用 2','disabled',''],['备用 3','disabled','']];
  if(batched)for(let slot=4;slot<16;slot++)catalog.push([slot===15?'最高频道':'',slot===15?'agent':'disabled','']);
  t.mock.method(console,'log',line=>records.push(JSON.parse(line)));
  upstream.on('connection',(socket,req)=>{
    assert.equal(req.headers.authorization,'Bearer pocket-only');
    assert.equal(req.headers['x-voxi-agent-reply'],'sent-v1');
    assert.equal(req.headers['x-voxi-device-id'],'esp32-111111111111');
    assert.equal(req.headers['x-voxi-channels'],batched?'blocks-v1':undefined);
    assert.equal(req.headers['x-voxi-link'],batched?'cellular-v1':undefined);
    for(let offset=0;offset<catalog.length;offset+=4)socket.send(JSON.stringify({type:'channel_catalog',
      channels:catalog.slice(offset,offset+4),...(batched?{offset,total:catalog.length}:{})}));
    socket.send(JSON.stringify({type:'ready',channel:0}));
    socket.on('message',(raw,binary)=>{
      if(binary){seen.push({pcm:raw.length});return;}
      const e=JSON.parse(raw);seen.push(e);
      if(e.type==='ptt_up'){
        socket.send(JSON.stringify({type:'audio_start'}));socket.send(Buffer.alloc(48000));socket.send(JSON.stringify({type:'audio_end',agentReply:'fixture-reply'}));
      }
    });
  });
  const {server,wss}=createGateway({mode:'pocket',requireDeviceEnrollment:false,token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only','X-Voxi-Device-Id':'esp32-111111111111','X-Voxi-Audio-Format':'opus-24000-v1',...(batched?{'X-Voxi-Downlink-Codecs':`${OPUS_BATCH_FORMAT},opus-24000-v1`,'X-Voxi-Channels':'blocks-v1','X-Voxi-Link':'cellular-v1'}:{})}});
  const messages=[],packets=[];let pcm=0;
  device.on('message',(raw,binary)=>{if(binary){pcm+=raw.length;packets.push(raw);}else {
    const event=JSON.parse(raw);messages.push(event);
    if(event.type==='audio_start')device.send(JSON.stringify({type:'playback_credit',flowId:event.flowId,consumedBytes:0,capacityBytes:576000}));
  }});
  async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
  await until(()=>messages.some(e=>e.type==='ready'));
  const blocks=messages.filter(e=>e.type==='channel_catalog');
  assert.deepEqual(blocks.flatMap(e=>e.channels),catalog);
  if(batched)assert.deepEqual(blocks.map(e=>[e.offset,e.total]),[[0,16],[4,16],[8,16],[12,16]]);
  device.send(JSON.stringify({type:'ptt_down'}));device.send(Buffer.alloc(5760));device.send(JSON.stringify({type:'ptt_up'}));
  await until(()=>messages.some(e=>e.type==='audio_end'));
  assert.equal(messages.find(e=>e.type==='audio_end').agentReply,undefined);
  await until(()=>seen.some(e=>e.type==='agent_reply_sent'&&e.replyId==='fixture-reply'));
  const downlink=records.find(e=>e.event==='pocket_downlink');
  assert.equal(downlink.creditEnabled,true);assert(downlink.creditUpdates>=1);
  assert.equal(seen.some(e=>e.type==='playback_credit'),false);
  assert.equal(downlink.connection,1);assert.equal(downlink.reply,1);assert.equal(downlink.outcome,'complete');
  let frames=[];
  if(batched){
    assert(packets.length<30,'coalescing should reduce actual WebSocket messages');
    for(const wire of packets){let at=1;assert(wire[0]>=1&&wire[0]<=3);for(let i=0;i<wire[0];i++){const n=wire.readUInt16LE(at);at+=2;frames.push(wire.subarray(at,at+n));at+=n;}assert.equal(at,wire.length);}
  }else frames=packets;
  assert.equal(frames.length,51);frames.forEach((p,i)=>assert.equal(p.readUInt32LE(),i));
  const expectedBytes=51*(4+OPUS_BITRATE/400)+(batched?102+packets.length:0);
  assert.equal(downlink.sourcePcmBytes,48000);assert.equal(downlink.sentBytes,expectedBytes);
  assert.equal(downlink.sentMessages,packets.length);
  assert.equal(messages.find(e=>e.type==='ready').audioFormat,batched?OPUS_BATCH_FORMAT:'opus-24000-v1');assert.equal(messages.find(e=>e.type==='ready').audioBitrate,OPUS_BITRATE);assert.equal(pcm,expectedBytes);assert.deepEqual(seen.slice(0,3),[{type:'ptt_down'},{pcm:5760},{type:'ptt_up'}]);
  const target=batched?15:2;
  device.send(JSON.stringify({type:'channel',channel:target}));await until(()=>seen.some(e=>e.channel===target));
  device.close();
});
}

test('Pocket flush drops an unsent partial batch and the next reply restarts at sequence zero',async t=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});
 await new Promise(r=>upstream.once('listening',r));
 upstream.on('connection',socket=>{
  socket.send(JSON.stringify({type:'ready'}));
  socket.on('message',(raw,binary)=>{
   if(binary||JSON.parse(raw).type!=='ptt_up')return;
   socket.send(JSON.stringify({type:'audio_start'}));socket.send(Buffer.alloc(960));
   setTimeout(()=>{
    if(socket.readyState!==1)return;
    socket.send(JSON.stringify({type:'flush'}));socket.send(JSON.stringify({type:'audio_start'}));
    socket.send(Buffer.alloc(960));socket.send(JSON.stringify({type:'audio_end'}));
   },10);
  });
 });
 const {server,wss}=createGateway({mode:'pocket',requireDeviceEnrollment:false,token:'device',pocketToken:'pocket',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
 const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device','X-Voxi-Audio-Format':'opus-24000-v1','X-Voxi-Downlink-Codecs':OPUS_BATCH_FORMAT}});
 const events=[];
 device.on('message',(raw,binary)=>{events.push(binary?{wire:raw}:JSON.parse(raw));});
 async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,2));}}
 await until(()=>events.some(e=>e.type==='ready'));device.send(JSON.stringify({type:'ptt_down'}));device.send(JSON.stringify({type:'ptt_up'}));
 await until(()=>events.some(e=>e.type==='audio_end'));
 const flush=events.findIndex(e=>e.type==='flush'),packets=events.filter(e=>e.wire);
 assert.equal(events.slice(0,flush).some(e=>e.wire),false);
 assert.equal(packets.length,1);const wire=packets[0].wire;assert.equal(wire[0],2);
 assert.equal(wire.readUInt32LE(3),0);assert.equal(wire.readUInt32LE(5+wire.readUInt16LE(1)),1);
 assert(events.findLastIndex(e=>e.wire)<events.findIndex(e=>e.type==='audio_end'));
});

for(const [code,pattern] of [[403,/authentication rejected/],[404,/endpoint missing/],[503,/handshake failed/]]){
 test(`Pocket HTTP ${code} produces actionable device error`,async t=>{
  const backend=http.createServer((req,res)=>{res.writeHead(code);res.end();});
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  const {server,wss}=createGateway({mode:'pocket',requireDeviceEnrollment:false,token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();backend.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only','X-Voxi-Audio-Format':'opus-24000-v1'}});
  const result=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('No error reported')),2000);device.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='error'){clearTimeout(timeout);resolve(e);}});device.on('error',reject);});
  assert.match(result.message,pattern);assert.match(result.message,new RegExp(String(code)));device.close();
 });
}

test('Pocket accepts exactly 20 seconds and rejects one extra PCM sample',async t=>{
  const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>upstream.once('listening',r));
  const seen=[];
  upstream.on('connection',(socket,req)=>{
    assert.equal(req.headers.authorization,'Bearer pocket-only');
    socket.send(JSON.stringify({type:'ready',channel:0}));
    socket.on('message',(raw,binary)=>{
      if(binary){seen.push({pcm:raw.length});return;}
      const e=JSON.parse(raw);seen.push(e);
      if(e.type==='ptt_up'){
        socket.send(JSON.stringify({type:'audio_start'}));socket.send(Buffer.alloc(960));socket.send(JSON.stringify({type:'audio_end'}));
      }
    });
  });
  const {server,wss}=createGateway({mode:'pocket',requireDeviceEnrollment:false,token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only','X-Voxi-Audio-Format':'opus-24000-v1'}});
  const messages=[];let pcm=0;
  device.on('message',(raw,binary)=>{if(binary)pcm+=raw.length;else messages.push(JSON.parse(raw));});
  async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
  await until(()=>messages.some(e=>e.type==='ready'));
  device.send(JSON.stringify({type:'ptt_down'}));
  for(let i=0;i<500;i++){
    device.send(Buffer.alloc(1920));
    await new Promise(r=>setImmediate(r));
  }
  await until(()=>seen.filter(e=>e.pcm).reduce((n,e)=>n+e.pcm,0)===960000);
  assert.equal(messages.some(e=>e.type==='error'),false);
  device.send(Buffer.alloc(2));
  await until(()=>messages.some(e=>e.type==='error'));
  assert.match(messages.find(e=>e.type==='error').message,/overlong PCM/);
});
