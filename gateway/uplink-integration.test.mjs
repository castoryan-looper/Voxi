import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer,WebSocket} from 'ws';
import {createGateway} from './server.mjs';
import {OpusDownlink} from './opus.mjs';
import {UPLINK_FORMAT} from './uplink.mjs';
test('Pocket receives decoded microphone audio and final tail before submission',async t=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await new Promise(r=>upstream.once('listening',r));
 const seen=[];upstream.on('connection',socket=>{socket.send(JSON.stringify({type:'ready',channel:0}));socket.on('message',(raw,binary)=>seen.push(binary?Buffer.from(raw):JSON.parse(raw)));});
 const {server,wss}=createGateway({mode:'pocket',requireDeviceEnrollment:false,token:'device',pocketToken:'pocket',pocketUrl:`ws://127.0.0.1:${upstream.address().port}/voxi`});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{for(const c of wss.clients)c.terminate();for(const c of upstream.clients)c.terminate();wss.close();upstream.close();server.close();});
 const device=new WebSocket(`ws://127.0.0.1:${server.address().port}/radio`,{headers:{Authorization:'Bearer device','X-Voxi-Audio-Format':'opus-24000-v1'}});
 const events=[];device.on('message',(raw,binary)=>{if(!binary)events.push(JSON.parse(raw));});
 async function until(check){const start=Date.now();while(!check()){if(Date.now()-start>2500)throw Error('Timed out');await new Promise(r=>setTimeout(r,5));}}
 await until(()=>events.some(e=>e.type==='ready'));assert.equal(events.find(e=>e.type==='ready').uplinkFormat,UPLINK_FORMAT);
 const encoder=new OpusDownlink(16000);encoder.reset();t.after(()=>encoder.close());const pcm=Buffer.alloc(9600);for(let i=0;i<4800;i++)pcm.writeInt16LE(Math.round(10000*Math.sin(i*2*Math.PI*500/24000)),i*2);
 const frames=[...encoder.audio(pcm),...encoder.finish()];device.send(JSON.stringify({type:'ptt_down',audioFormat:UPLINK_FORMAT}));
 for(let i=0;i<frames.length;i+=5){const group=frames.slice(i,i+5),parts=[Buffer.from([i,0,0,0,group.length])];for(let k=0;k<group.length;k++){const h=Buffer.alloc(4);h.writeUInt16LE(i+k===frames.length-1?0:480);h.writeUInt16LE(40,2);parts.push(h,group[k].subarray(4));}device.send(Buffer.concat(parts));}
 device.send(JSON.stringify({type:'ptt_up'}));await until(()=>seen.some(e=>e.type==='ptt_up'));
 assert.equal(seen[0].type,'ptt_down');assert.equal(seen.at(-1).type,'ptt_up');const decoded=Buffer.concat(seen.filter(Buffer.isBuffer));assert.equal(decoded.length,10560);assert.ok(decoded.some(b=>b!==0));
});
