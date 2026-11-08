import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVoicePreview} from './voice-preview.mjs';

function wav(){const bytes=Buffer.alloc(48);bytes.write('RIFF',0);bytes.write('WAVE',8);return bytes.toString('base64');}
function fixture(request){const audio={hidden:true,pause(){},removeAttribute(){this.src='';},load(){},async play(){this.played=true;}},status={textContent:''};return {audio,status,player:createVoicePreview({audio,status,request})};}
test('preview plays returned audio without saving and stop removes the temporary media',async()=>{
 const requests=[];const f=fixture(async body=>{requests.push(body);return {voice:body.voice,audioFormat:'wav',audioBase64:wav()};});
 await f.player.play('ember');assert.deepEqual(requests,[{voice:'ember'}]);assert.ok(f.audio.played);assert.match(f.audio.src,/^blob:/);assert.equal(f.audio.hidden,false);
 f.audio.onended();assert.match(f.status.textContent,/试听结束/);f.player.stop();assert.equal(f.audio.src,'');assert.equal(f.audio.hidden,true);
});
test('late preview responses cannot revive audio after stop or a new selection',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));const pending=f.player.play('cove');f.player.stop();resolve({voice:'cove',audioFormat:'wav',audioBase64:wav()});await pending;
 assert.equal(f.audio.played,undefined);assert.equal(f.audio.hidden,true);
});
test('failed generation and unsupported audio never pretend to play',async()=>{
 const f=fixture(async()=>{throw Error('当前账户不支持所选音色');});await f.player.play('ember');assert.match(f.status.textContent,/不支持/);assert.equal(f.audio.hidden,true);
 const mismatch=fixture(async()=>({voice:'cove',audioFormat:'wav',audioBase64:wav()}));await mismatch.player.play('ember');assert.equal(mismatch.audio.played,undefined);
});
