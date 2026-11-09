import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGateway} from './server.mjs';
import {RadioFilter} from './radio.mjs';
import {OPUS_BITRATE} from './opus.mjs';

for(const format of [undefined,'pcm16-24000','mulaw8-24000','opus-unsupported'])test('old or absent downlink format is explicitly rejected: '+format,async t=>{
 const {server,wss}=createGateway({token:'test'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
 const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer test',...(format?{'X-Voxi-Audio-Format':format}:{})}});
 let error;ws.on('message',raw=>{error=JSON.parse(raw);});
 const code=await new Promise(r=>ws.once('close',r));assert.equal(code,1008);assert.equal(error.code,'opus_required');
});

test('mock: authentication, short press, streaming, interruption and channel reset',async t=>{
  const {server,wss}=createGateway({token:'test'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`ws://127.0.0.1:${server.address().port}/radio`;
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
  const rejected=new WebSocket(url);
  const code=await new Promise(r=>rejected.on('close',r));assert.equal(code,1008);
  const ws=new WebSocket(url,{headers:{Authorization:'Bearer test','X-Voxi-Audio-Format':'opus-24000-v1'}});
  const messages=[];let audio=0;
  ws.on('message',(b,binary)=>{if(binary){assert.equal(b.length,4+OPUS_BITRATE/400);audio++;}else messages.push(JSON.parse(b));});
  async function until(predicate){const start=Date.now();while(!predicate()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
  const send=o=>ws.send(JSON.stringify(o));
  await until(()=>messages.some(e=>e.type==='ready'));
  send({type:'ptt_down'});ws.send(Buffer.alloc(960));send({type:'ptt_up'});
  await until(()=>messages.some(e=>e.reason==='too_short'));assert.equal(audio,0);
  send({type:'ptt_down'});for(let i=0;i<6;i++)ws.send(Buffer.alloc(960));send({type:'ptt_up'});
  await until(()=>audio>=2);
  send({type:'ptt_down'});await until(()=>messages.filter(e=>e.type==='recording').length===3);
  await new Promise(r=>setTimeout(r,35));const stopped=audio;
  await new Promise(r=>setTimeout(r,60));assert.equal(audio,stopped);
  send({type:'channel',channel:2});await until(()=>messages.some(e=>e.type==='ready'&&e.channel===2));
  send({type:'ptt_down'});for(let i=0;i<6;i++)ws.send(Buffer.alloc(960));send({type:'ptt_up'});
  await until(()=>messages.some(e=>e.type==='audio_end'));assert.ok(audio>=stopped+15);
  ws.close();
});
test('filter rejects DC and stays in PCM16 range',()=>{
  const f=new RadioFilter(),input=Buffer.alloc(48000);for(let i=0;i<input.length;i+=2)input.writeInt16LE(30000,i);
  const out=f.process(input);assert.ok(Math.abs(out.readInt16LE(out.length-2))<5);
  assert.equal(out.length,input.length);
});

test('peer Ping and incoming device traffic refresh liveness during downlink',async t=>{
 const {server,wss}=createGateway({token:'test'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
 const ws=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer test','X-Voxi-Audio-Format':'opus-24000-v1'}});
 await new Promise(r=>ws.once('open',r));const peer=[...wss.clients][0];
 const until=async check=>{const end=Date.now()+1000;while(!check()){if(Date.now()>end)throw Error('Peer activity did not refresh liveness');await new Promise(r=>setTimeout(r,5));}};
 peer.isAlive=false;ws.ping();await until(()=>peer.isAlive);
 peer.isAlive=false;ws.send(JSON.stringify({type:'played',ms:0}));await until(()=>peer.isAlive);
 ws.close();
});

test('cloud health and malformed events',async t=>{
  const {server,wss}=createGateway({token:'test',revision:'test-sha'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
  const port=server.address().port;
  const health=await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.deepEqual(await health.json(),{ok:true,mode:'mock',revision:'test-sha',downlinkFormat:'opus-24000-v1',opusOnly:true,audioBitrate:OPUS_BITRATE});
  assert.equal((await fetch(`http://127.0.0.1:${port}/unknown`)).status,404);
  const setup=await fetch(`http://127.0.0.1:${port}/setup/`);
  assert.equal(setup.status,200);assert.match(await setup.text(),/navigator\.serial/);
  const options={headers:{Authorization:'Bearer test','X-Voxi-Audio-Format':'opus-24000-v1'}};
  const first=new WebSocket(`ws://127.0.0.1:${port}/radio`,options);
  await new Promise(r=>first.once('open',r));
  const error=new Promise(resolve=>first.on('message',(raw,binary)=>{if(!binary){const e=JSON.parse(raw);if(e.type==='error')resolve(e);}}));
  first.send('null');assert.equal((await error).message,'Expected event object');
  first.close();
});

test('setup route returns HTML and malformed WebSocket frames do not crash gateway',async t=>{
 const {server,wss}=createGateway({token:'test'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
 const page=await fetch(base+'/setup/');assert.equal(page.status,200);assert.match(await page.text(),/Voxi/);
 const client=new WebSocket(base.replace('http:','ws:')+'/radio',{headers:{Authorization:'Bearer test','X-Voxi-Audio-Format':'opus-24000-v1'}});
 client.on('error',()=>{});
 await new Promise(r=>client.once('open',r));
 const closed=new Promise(r=>client.once('close',r));
 // Deliberately invalid client frame: the MASK bit is absent.
 client._socket.write(Buffer.from([0x82,0x02,0,0]));
 assert.equal(await closed,1002);
 const health=await fetch(base+'/healthz');assert.equal(health.status,200);
});

test('three authenticated devices keep independent channels',async t=>{
 const {server,wss}=createGateway({token:'shared-device-token'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
 const url=`ws://127.0.0.1:${server.address().port}/radio`;
 const connect=()=>new WebSocket(url,{headers:{Authorization:'Bearer shared-device-token','X-Voxi-Audio-Format':'opus-24000-v1'}});
 const a=connect(),b=connect(),ma=[],mb=[];
 a.on('message',(d,binary)=>{if(!binary)ma.push(JSON.parse(d));});b.on('message',(d,binary)=>{if(!binary)mb.push(JSON.parse(d));});
 const until=async fn=>{const end=Date.now()+2000;while(!fn()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}};
 await until(()=>ma.some(e=>e.type==='ready')&&mb.some(e=>e.type==='ready'));
 a.send(JSON.stringify({type:'channel',channel:3}));await until(()=>ma.some(e=>e.type==='ready'&&e.channel===3));
 assert.equal(mb.filter(e=>e.type==='ready').at(-1).channel,0);
 const third=connect(),mc=[];
 third.on('message',(d,binary)=>{if(!binary)mc.push(JSON.parse(d));});
 await until(()=>mc.some(e=>e.type==='ready'&&e.channel===0));
 assert.equal(a.readyState,WebSocket.OPEN);assert.equal(b.readyState,WebSocket.OPEN);
});
