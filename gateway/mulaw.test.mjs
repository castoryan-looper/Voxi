import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeMulaw} from './mulaw.mjs';
test('mu-law preserves 24kHz sample count, sign and bounded quantization',()=>{
 const samples=[0,8,-8,1000,-1000,16384,-16384,32767,-32768];
 const pcm=Buffer.alloc(samples.length*2);samples.forEach((n,i)=>pcm.writeInt16LE(n,i*2));
 const encoded=encodeMulaw(pcm);assert.equal(encoded.length,samples.length);assert.equal(encoded[0],255);assert.equal(encoded[3],206);assert.equal(encoded[4],78);
 for(let n=-32768;n<=32767;n+=31){const b=Buffer.alloc(2);b.writeInt16LE(n);const code=(~encodeMulaw(b)[0])&255,magnitude=(((code&15)<<3)+132)<<((code>>4)&7),decoded=(code&128)?132-magnitude:magnitude-132;assert.ok(Math.abs(decoded-n)<=Math.abs(n)*.035+8);}
 assert.throws(()=>encodeMulaw(Buffer.alloc(3)),/Incomplete/);
});
