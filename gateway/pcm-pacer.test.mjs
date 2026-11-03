import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PcmPacer} from './pcm-pacer.mjs';
function fixture(options={}){let clock=0,open=true;const sent=[],errors=[];
 const pacer=new PcmPacer({send:(data,binary)=>sent.push({data,binary}),fail:e=>errors.push(e),now:()=>clock,canSend:()=>open,...options});
 return {pacer,sent,errors,at:n=>clock=n,block:v=>open=!v};}
test('burst PCM is paced and audio_end/ready remain behind final samples',()=>{
 const f=fixture();const pcm=Buffer.alloc(4800);for(let i=0;i<pcm.length;i++)pcm[i]=i%251;
 f.pacer.audio(pcm);f.pacer.control('audio_end');f.pacer.control('ready');
 f.pacer.tick();assert.equal(f.sent.length,1);f.at(19);f.pacer.tick();assert.equal(f.sent.length,1);
 for(let t=20;t<=80;t+=20){f.at(t);f.pacer.tick();}
 assert.deepEqual(Buffer.concat(f.sent.filter(x=>x.binary).map(x=>x.data)),pcm);
 assert.deepEqual(f.sent.slice(-2).map(x=>x.data),['audio_end','ready']);assert.equal(f.pacer.bytes,0);
});
test('blocked transport preserves PCM and recovery never flushes a catch-up burst',()=>{
 const f=fixture();f.pacer.audio(Buffer.alloc(4800));f.block(true);f.at(1000);f.pacer.tick();assert.equal(f.sent.length,0);
 f.block(false);f.pacer.tick();f.pacer.tick();assert.equal(f.sent.length,1);
 f.at(1005);f.pacer.tick();assert.equal(f.sent.length,1);assert.equal(f.pacer.bytes,3840);
});
test('clearing a cancelled stream drops its queued end marker and PCM',()=>{
 const f=fixture();f.pacer.audio(Buffer.alloc(960));f.pacer.control('old-end');f.pacer.clear();f.pacer.control('flush');f.pacer.tick();
 assert.deepEqual(f.sent.map(x=>x.data),['flush']);assert.equal(f.pacer.bytes,0);
});
test('queue overflow fails explicitly but total drained story length is unlimited',()=>{
 const f=fixture({maxBytes:1920});f.pacer.audio(Buffer.alloc(1922));assert.equal(f.errors.length,1);
 const g=fixture({maxBytes:1920});for(let i=0;i<3000;i++){g.at(i*20);g.pacer.audio(Buffer.alloc(960));g.pacer.tick();}
 assert.equal(g.errors.length,0);assert.equal(g.sent.length,3000);
});
