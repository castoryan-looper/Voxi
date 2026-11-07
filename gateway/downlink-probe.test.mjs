import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DownlinkProbe} from './downlink-probe.mjs';

test('irregular source ticks still emit exactly 180 seconds of quiet 24kHz PCM',()=>{
 let clock=0,bytes=0,ends=0,peak=0;
 const probe=new DownlinkProbe({now:()=>clock,audio:pcm=>{
  assert.equal(pcm.length,960);bytes+=pcm.length;
  for(let i=0;i<pcm.length;i+=2)peak=Math.max(peak,Math.abs(pcm.readInt16LE(i)));
 },end:()=>ends++});
 probe.start(180);
 for(clock=0;clock<180000;clock+=31)probe.tick();
 clock=180000;probe.tick();probe.tick();
 assert.equal(bytes,180*48000);assert.equal(ends,1);assert.equal(probe.active,false);
 assert(peak>0&&peak<=800);
});
test('delayed source ticks have a bounded catch-up and cancellation emits nothing further',()=>{
 let clock=0,count=0,ends=0;
 const probe=new DownlinkProbe({now:()=>clock,audio:()=>count++,end:()=>ends++});
 for(const seconds of [0,181,-1,1.5,NaN])assert.throws(()=>probe.start(seconds));
 probe.start(180);clock=10000;probe.tick();assert.equal(count,5);
 probe.stop();clock=180000;probe.tick();assert.equal(count,5);assert.equal(ends,0);
 probe.start(1);clock+=1000;
 for(let i=0;i<10;i++)probe.tick();assert.equal(count,55);assert.equal(ends,1);
});
