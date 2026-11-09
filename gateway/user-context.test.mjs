import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseContextFile} from './user-context.mjs';

test('Open WebUI import keeps the active branch and skips incomplete output',async()=>{
 const messages={root:{role:'user',content:'中文问题'},old:{role:'assistant',content:'旧分支',parentId:'root'},
  current:{role:'assistant',content:'当前分支',parentId:'root'},draft:{role:'assistant',content:'未完成',done:false,parentId:'current'}};
 const result=await parseContextFile(JSON.stringify([{id:'chat-1',updated_at:1700000000,
  chat:{title:'MiniCam',history:{currentId:'draft',messages}}}]),'open-webui','chat.json');
 assert.equal(result[0].id,'chat-1');
 assert.deepEqual(result[0].messages.map(m=>m.text),['中文问题','当前分支']);
});

test('Claude export and Codex JSONL import only conversation text',async()=>{
 const claude=await parseContextFile(JSON.stringify([{uuid:'claude-1',name:'Dev',chat_messages:[
  {sender:'human',text:'Please continue'},
  {sender:'assistant',content:[{type:'thinking',text:'Hidden reasoning'},{type:'text',text:'Visible'}]}]}]),'claude','claude.json');
 assert.deepEqual(claude[0].messages.map(m=>m.text),['Please continue','Visible']);
 const codex=await parseContextFile([
  {type:'session_meta',payload:{id:'codex-1'}},
  {type:'response_item',payload:{type:'function_call_output',output:'private tool result'}},
  {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'问题'}]}}
 ].map(x=>JSON.stringify(x)).join('\n'),'codex','codex.jsonl');
 assert.deepEqual(codex[0].messages,[{role:'user',text:'问题'}]);
});
