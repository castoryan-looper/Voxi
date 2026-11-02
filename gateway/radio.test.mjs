import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {createGateway} from './server.mjs';
import {RadioFilter} from './radio.mjs';

test('mock: authentication, short press, streaming, interruption and channel reset',async t=>{
  const {server,wss}=createGateway({token:'test'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`ws://127.0.0.1:${server.address().port}/radio`;
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
  const rejected=new WebSocket(url);
  const code=await new Promise(r=>rejected.on('close',r));assert.equal(code,1008);
  const ws=new WebSocket(url,{headers:{Authorization:'Bearer test'}});
  const messages=[];let audio=0;
  ws.on('message',(b,binary)=>{if(binary){assert.equal(b.length,960);audio++;}else messages.push(JSON.parse(b));});
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

test('cloud health, connection budget and malformed events',async t=>{
  const {server,wss}=createGateway({token:'test',maxConnections:1,revision:'test-sha'});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();});
  const port=server.address().port;
  const health=await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.deepEqual(await health.json(),{ok:true,mode:'mock',revision:'test-sha'});
  assert.equal((await fetch(`http://127.0.0.1:${port}/unknown`)).status,404);
  const options={headers:{Authorization:'Bearer test'}};
  const first=new WebSocket(`ws://127.0.0.1:${port}/radio`,options);
  await new Promise(r=>first.once('open',r));
  const second=new WebSocket(`ws://127.0.0.1:${port}/radio`,options);
  assert.equal(await new Promise(r=>second.once('close',r)),1013);
  const error=new Promise(resolve=>first.on('message',(raw,binary)=>{if(!binary){const e=JSON.parse(raw);if(e.type==='error')resolve(e);}}));
  first.send('null');assert.equal((await error).message,'Expected event object');
  first.close();
});
