import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer,WebSocket} from 'ws';
import {createGateway} from './server.mjs';

test('Pocket proxy preserves credentials, PCM, PTT and channel controls without an API key',async t=>{
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
  const {server,wss}=createGateway({mode:'pocket',token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only'}});
  const messages=[];let pcm=0;
  device.on('message',(raw,binary)=>{if(binary)pcm+=raw.length;else messages.push(JSON.parse(raw));});
  async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>2000)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
  await until(()=>messages.some(e=>e.type==='ready'));
  device.send(JSON.stringify({type:'ptt_down'}));device.send(Buffer.alloc(5760));device.send(JSON.stringify({type:'ptt_up'}));
  await until(()=>messages.some(e=>e.type==='audio_end'));
  assert.equal(pcm,960);assert.deepEqual(seen.slice(0,3),[{type:'ptt_down'},{pcm:5760},{type:'ptt_up'}]);
  device.send(JSON.stringify({type:'channel',channel:2}));await until(()=>seen.some(e=>e.channel===2));
  device.close();
});

for(const [code,pattern] of [[403,/authentication rejected/],[404,/endpoint missing/],[503,/handshake failed/]]){
 test(`Pocket HTTP ${code} produces actionable device error`,async t=>{
  const backend=http.createServer((req,res)=>{res.writeHead(code);res.end();});
  await new Promise(r=>backend.listen(0,'127.0.0.1',r));
  const {server,wss}=createGateway({mode:'pocket',token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${backend.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();wss.close();server.close();backend.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only'}});
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
  const {server,wss}=createGateway({mode:'pocket',token:'device-only',pocketToken:'pocket-only',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
  const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device-only'}});
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
