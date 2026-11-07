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

test('credit-only larger pending bound preserves a 3-minute source through a 100s downlink stall',()=>{
 const f=fixture({maxCreditBytes:120*48000});f.pacer.beginStream('probe');
 assert(f.pacer.feedback({flowId:'probe',consumedBytes:0,capacityBytes:576000}));
 let delivered=0,consumed=0,seen=0,buffer=0,peak=0,primed=false;
 for(let t=0;t<310000;t+=5){
  f.at(t);
  if(t<180000&&t%20===0)f.pacer.audio(Buffer.alloc(960));
  if(t===180000)f.pacer.control('audio_end');
  f.pacer.tick();
  if(t<20000||t>=120000){
   while(seen<f.sent.length){const packet=f.sent[seen++];if(packet.binary){buffer+=packet.data.length;delivered+=packet.data.length;}}
  }
  if(buffer>=96000)primed=true;
  if(primed&&t%20===0){if(buffer>=960){buffer-=960;consumed+=960;}else primed=false;}
  if(t%1500===0)assert(f.pacer.feedback({flowId:'probe',consumedBytes:consumed,capacityBytes:576000}));
  peak=Math.max(peak,f.pacer.bytes);assert(buffer<=576000);
 }
 assert.deepEqual(f.errors,[]);assert.equal(delivered,180*48000);
 assert(peak>30*48000&&peak<=120*48000);assert.equal(f.pacer.bytes,0);
 assert.equal(f.sent.at(-1).data,'audio_end');
 assert(f.pacer.flow.peakOutstanding<=8*48000);
 const legacy=fixture({maxCreditBytes:120*48000});legacy.pacer.audio(Buffer.alloc(30*48000+2));
 assert.match(legacy.errors[0],/30 seconds/);
 const tooLong=fixture({maxCreditBytes:120*48000});tooLong.pacer.beginStream('x');tooLong.pacer.feedback({flowId:'x',consumedBytes:0,capacityBytes:576000});tooLong.pacer.audio(Buffer.alloc(120*48000+2));
 assert.match(tooLong.errors[0],/120 seconds/);
});

test('queued tail controls stay bounded independently of a long PCM backlog',()=>{
 const f=fixture({maxBytes:120*48000});f.pacer.audio(Buffer.alloc(100*48000));
 for(let i=0;i<64;i++)f.pacer.control('tail');
 assert.equal(f.errors.length,0);f.pacer.control('overflow');assert.equal(f.errors.length,1);
 assert.equal(f.pacer.controls,64);f.pacer.clear();assert.equal(f.pacer.controls,0);
});

test('credit refill is twice realtime but never exceeds unconsumed capacity',()=>{
 const f=fixture();f.pacer.beginStream('r1');
 assert(f.pacer.feedback({flowId:'r1',consumedBytes:0,capacityBytes:96000}));
 f.pacer.audio(Buffer.alloc(96000));
 for(let t=0;t<=2000;t+=5){f.at(t);f.pacer.tick();}
 assert.equal(f.sent.length,50);assert.equal(f.pacer.sentPcm,48000);
 assert(f.pacer.feedback({flowId:'r1',consumedBytes:24000,capacityBytes:96000}));
 for(let t=2005;t<3000;t+=5){f.at(t);f.pacer.tick();}
 assert.equal(f.pacer.sentPcm,72000);assert.equal(f.pacer.bytes,24000);
});
test('wrong-turn and impossible credit cannot open an unsafe send window',()=>{
 const f=fixture();f.pacer.beginStream('new');f.pacer.audio(Buffer.alloc(96000));
 assert(!f.pacer.feedback({flowId:'old',consumedBytes:0,capacityBytes:576000}));
 assert(!f.pacer.feedback({flowId:'new',consumedBytes:960000,capacityBytes:576000}));
 assert(!f.pacer.feedback({flowId:'new',consumedBytes:0,capacityBytes:1e9}));
 assert(f.pacer.feedback({flowId:'new',consumedBytes:0,capacityBytes:576000}));
 f.at(6001);f.pacer.tick();assert.equal(f.sent.length,1);
 assert(f.pacer.feedback({flowId:'new',consumedBytes:0,capacityBytes:576000}));
 f.at(6011);f.pacer.tick();assert.equal(f.sent.length,2);
 f.pacer.clear();assert(!f.pacer.feedback({flowId:'new',consumedBytes:0,capacityBytes:576000}));
});
test('long credit-controlled reply keeps in-flight plus buffered PCM bounded across stalls',()=>{
 const f=fixture({maxBytes:120*48000});f.pacer.beginStream('long');
 f.pacer.audio(Buffer.alloc(60*48000));f.pacer.control('audio_end');
 let consumed=0,maxOutstanding=0;
 for(let t=0;t<110000;t+=5){
   f.at(t);
   // Device playback stalls 6 seconds; no new consumption credit is invented.
   if(!(t>=20000&&t<26000))consumed=Math.min(f.pacer.sentPcm,consumed+240);
   if(t%1500===0)assert(f.pacer.feedback({flowId:'long',consumedBytes:consumed,capacityBytes:576000}));
   f.pacer.tick();maxOutstanding=Math.max(maxOutstanding,f.pacer.sentPcm-consumed);
 }
 assert(maxOutstanding<=8*48000);assert.equal(f.pacer.bytes,0);
 assert.equal(f.sent.at(-1).data,'audio_end');assert.equal(f.errors.length,0);
});

test('lost feedback fails explicitly after a bounded wait',()=>{
 const f=fixture();f.pacer.beginStream('r');f.pacer.audio(Buffer.alloc(960));
 assert(f.pacer.feedback({flowId:'r',consumedBytes:0,capacityBytes:576000}));
 f.at(60001);f.pacer.tick();assert.equal(f.sent.length,0);
 assert.deepEqual(f.errors,['Playback feedback timed out']);assert.equal(f.pacer.bytes,0);
});

test('delayed feedback preserves unspent credit without exceeding absolute window',()=>{
 const f=fixture();f.pacer.beginStream('r');f.pacer.audio(Buffer.alloc(96000));
 f.pacer.feedback({flowId:'r',consumedBytes:0,capacityBytes:96000});
 for(let t=6500;t<7500;t+=10){f.at(t);f.pacer.tick();}
 assert.equal(f.pacer.sentPcm,48000);assert.equal(f.pacer.bytes,48000);
 assert(f.pacer.metrics().creditWindowBlockedChecks>0);
 f.pacer.feedback({flowId:'r',consumedBytes:24000,capacityBytes:96000});
 assert.equal(f.pacer.metrics().creditMaxFeedbackGapMs,7490);
 for(let t=7500;t<8500;t+=10){f.at(t);f.pacer.tick();}
 assert.equal(f.pacer.sentPcm,72000);
});

test('three-minute stream survives 26-second feedback blackout within capacity and backlog bounds',()=>{
 const f=fixture();f.pacer.beginStream('long-cellular');
 let consumed=0,maxOutstanding=0,frames=0,endQueued=false;
 for(let t=0;t<220000;t+=5){
   f.at(t);
   if(t<180000&&t%20===0){f.pacer.audio(Buffer.alloc(960));frames++;}
   if(t===180000){f.pacer.control('audio_end');endQueued=true;}
   // Playback cannot consume more data than has been transmitted.
   consumed=Math.min(f.pacer.sentPcm,consumed+240);
   if(t%1500===0&&!(t>=19500&&t<46500))
     assert(f.pacer.feedback({flowId:'long-cellular',consumedBytes:consumed,capacityBytes:576000}));
   f.pacer.tick();maxOutstanding=Math.max(maxOutstanding,f.pacer.sentPcm-consumed);
   assert(f.pacer.bytes<=30*48000);
 }
 assert(endQueued);assert.equal(frames,9000);assert.equal(f.pacer.bytes,0);
 assert.equal(f.pacer.sentPcm,180*48000);assert(maxOutstanding<=8*48000);
 assert.equal(f.sent.at(-1).data,'audio_end');assert.deepEqual(f.errors,[]);
});
