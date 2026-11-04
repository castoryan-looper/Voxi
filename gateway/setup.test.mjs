import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./setup.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
function page(){
 const nodes=new Map(),stored=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},checked:false,hidden:false,disabled:false,textContent:'',children:[],replaceChildren(...v){this.children=v;},append(v){this.children.push(v);},add(v){this.children.push(v);},reportValidity(){return true;}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:get,createElement:()=>({append(){}})},location:{protocol:'http:',hostname:'localhost'},TextDecoder,TextEncoder,Map,Set,Promise,Error,Number,JSON,Math,Option:class{constructor(text,value){this.text=text;this.value=value;}},setInterval(){},setTimeout,clearTimeout,sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k),removeItem:k=>stored.delete(k)}});
 vm.runInContext(source,context);return {context,get,stored};
}

test('standby settings preserve edits during polling, validate order and save without reboot',async()=>{
 const {context,get}=page();
 vm.runInContext("updateStandby({standbyMode:'tiered',standbyScreenMinutes:1,standbyLinkMinutes:5,standbySleepMinutes:15});",context);
 assert.equal(get('standby').hidden,false);assert.equal(get('standbyLink').value,'5');
 get('standbyLink').value='8';get('standbyLink').oninput();
 vm.runInContext("updateStandby({standbyMode:'tiered',standbyScreenMinutes:1,standbyLinkMinutes:5,standbySleepMinutes:15});",context);
 assert.equal(get('standbyLink').value,'8');
 context.calls=[];vm.runInContext("api=async(method,body)=>{calls.push({method,body});return {standbyMode:'tiered',standbyScreenMinutes:1,standbyLinkMinutes:8,standbySleepMinutes:15,message:'已保存'};};",context);
 get('standbySleep').value='2';await get('saveStandby').onclick();assert.equal(context.calls.length,0);
 get('standbySleep').value='15';await get('saveStandby').onclick();assert.equal(context.calls.length,1);
 assert.equal(context.calls[0].method,'standby_settings');assert.equal(context.calls[0].body.linkMinutes,8);
 assert.equal(get('standbyMessage').textContent,'已保存');
 await get('disconnect').onclick();assert.equal(get('standby').hidden,true);
});
test('save reports write failure and retains secrets for correction',async()=>{
 const {context,get}=page();get('password').value='password';get('token').value='test-token';
 vm.runInContext("api=async()=>{throw Error('存储写入失败');}",context);
 await get('form').onsubmit({preventDefault(){}});
 assert.match(get('message').textContent,/存储写入失败/);assert.equal(get('password').value,'password');assert.equal(get('token').value,'test-token');assert.equal(get('save').disabled,false);
});
test('successful save tracks revision for reboot verification',async()=>{
 const {context,get,stored}=page();get('password').value='password';get('token').value='test-token';
 vm.runInContext("api=async()=>({saved:true,configRevision:'abc123',message:'保存成功'});",context);
 await get('form').onsubmit({preventDefault(){}});
 assert.equal(stored.get('voxiExpectedRevision'),'abc123');assert.equal(get('token').value,'');assert.match(get('message').textContent,/abc123/);
});
test('invalid form gives visible feedback without sending',async()=>{
 const {context,get}=page();get('form').reportValidity=()=>false;
 vm.runInContext("api=async()=>{throw Error('must not send');}",context);
 await get('form').onsubmit({preventDefault(){}});assert.match(get('message').textContent,/补全/);
});
test('remembered Wi-Fi selection reuses stored password',()=>{
 const {get}=page();get('savedWifi').value='home';get('password').value='old';get('savedWifi').onchange();assert.equal(get('ssid').value,'home');assert.equal(get('password').value,'');
});

test('USB sends certificate-sized requests in bounded chunks and preserves response',async()=>{
 const {context}=page();const chunks=[];
 context.capture=bytes=>{chunks.push(Uint8Array.from(bytes));return Promise.resolve();};
 const operation=vm.runInContext("writer={write:capture};api('save',{ca:'x'.repeat(6000)})",context);
 let bytes=Buffer.alloc(0);
 for(let i=0;i<200;i++){
   bytes=Buffer.concat(chunks.map(v=>Buffer.from(v)));
   if(bytes.at(-1)===10)break;
   await new Promise(r=>setTimeout(r,10));
 }
 assert.ok(chunks.length>40);assert.ok(chunks.every(v=>v.length<=128));
 const req=JSON.parse(bytes.toString());assert.equal(req.body.ca.length,6000);
 vm.runInContext(`{const p=pending.get(${req.id});clearTimeout(p.timer);pending.delete(${req.id});p.resolve({saved:true});}`,context);
 assert.equal((await operation).saved,true);
});

test('remembered credentials are indicated without exposing a token',()=>{
 const {context,get}=page();
 vm.runInContext("fill({tokenConfigured:true,caConfigured:true,ca:'certificate',host:'example.com'});",context);
 assert.equal(get('token').value,'');assert.match(get('token').placeholder,/已记住/);assert.match(get('cloudSaved').textContent,/令牌：已记住/);assert.match(get('cloudSaved').textContent,/证书：已记住/);
});
test('offline AI does not imply remembered cloud settings were lost',async()=>{
 const {context,get}=page();
 vm.runInContext("loaded=true;writer={};api=async()=>({configured:true,cloudConfigured:true,tokenConfigured:true,caConfigured:true,cloudReady:false,wifiConnected:true,connectionStage:'gateway_connecting',uptimeMs:10000,configRevision:'saved'});",context);
 await vm.runInContext('status()',context);
 assert.match(get('detail').textContent,/已从设备读取保存的配置 saved/);
 assert.match(get('connectionNotice').textContent,/正在连接云端网关/);
 assert.doesNotMatch(get('connectionNotice').textContent,/未保存|重新填写/);
});

test('live radio debug shows capture, network bytes and recent device events',async()=>{
 const {context,get}=page();
 vm.runInContext("loaded=true;writer={};api=async()=>({configured:true,cloudConfigured:true,tokenConfigured:true,caConfigured:true,cloudReady:true,wifiConnected:true,uptimeMs:10000,radioDebug:{phase:'RECORDING',micBytes:48000,sentBytes:47520,receivedBytes:0,micPeak:2048,events:['10s REC started']}});",context);
 await vm.runInContext('status()',context);
 assert.match(get('radioLog').textContent,/RECORDING/);
 assert.match(get('radioLog').textContent,/MIC 48000 B/);
 assert.match(get('radioLog').textContent,/TX 47520 B/);
 assert.match(get('radioLog').textContent,/10s REC started/);
});

test('volume controls load actual saved level and retain an unsaved edit during polling',async()=>{
 const {context,get}=page();
 vm.runInContext("loaded=true;writer={};api=async()=>({speakerVolume:75,busy:false});",context);
 await vm.runInContext('status()',context);
 assert.equal(get('audio').hidden,false);assert.equal(get('speakerVolume').value,'75');assert.equal(get('volumeSlider').value,'75');assert.equal(get('volumeValue').textContent,'75%');
 get('volumeSlider').value='88';get('volumeSlider').oninput();
 await vm.runInContext('status()',context);
 assert.equal(get('speakerVolume').value,'88');assert.match(get('volumeMessage').textContent,/待保存音量：88/);
});
test('volume save sends selected level and displays persistent success beside controls',async()=>{
 const {context,get}=page();let received;
 context.saveRequest=(method,body)=>{received={method,body};return Promise.resolve({speakerVolume:82,message:'音量已保存'});};
 vm.runInContext('api=saveRequest;',context);get('speakerVolume').value='82';
 await get('saveVolume').onclick();
 assert.equal(received.method,'speaker_volume');assert.equal(received.body.volume,82);assert.match(get('volumeMessage').textContent,/已保存.*82%/);assert.equal(get('volumeSlider').value,'82');
});

test('USB disconnect hides the volume section and disables its controls',async()=>{
 const {context,get}=page();get('audio').hidden=false;
 vm.runInContext("loaded=true;port={readable:{getReader(){return {read:async()=>({done:true}),releaseLock(){}}}}};",context);
 await vm.runInContext('readUsb()',context);
 assert.equal(get('audio').hidden,true);
 assert.equal(get('saveVolume').disabled,true);
 assert.equal(get('speakerTest').disabled,true);
});
