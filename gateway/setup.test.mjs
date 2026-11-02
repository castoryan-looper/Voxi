import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./setup.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
function page(){
 const nodes=new Map(),stored=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,hidden:false,disabled:false,textContent:'',children:[],replaceChildren(...v){this.children=v;},append(v){this.children.push(v);},add(v){this.children.push(v);},reportValidity(){return true;}});return nodes.get(id);};
 const context=vm.createContext({document:{getElementById:get,createElement:()=>({append(){}})},location:{protocol:'http:',hostname:'localhost'},TextDecoder,TextEncoder,Map,Set,Promise,Error,Number,JSON,Math,Option:class{constructor(text,value){this.text=text;this.value=value;}},setInterval(){},setTimeout,clearTimeout,sessionStorage:{setItem:(k,v)=>stored.set(k,v),getItem:k=>stored.get(k),removeItem:k=>stored.delete(k)}});
 vm.runInContext(source,context);return {context,get,stored};
}
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
