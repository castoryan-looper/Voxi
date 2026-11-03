#!/usr/bin/env bash
set -Eeuo pipefail
# Check the same backend path used by the public editor. Never print credentials
# or prompt text to the terminal.
docker exec -i voxi-gateway-1 node --input-type=module <<'JS'
import {pocketSettings} from './pocket-settings.mjs';
import {readFileSync} from 'node:fs';
try {
  if(process.env.MODE!=='pocket')throw Error('网关不是 Pocket 模式');
  const result=await pocketSettings({url:process.env.POCKET_URL,token:process.env.POCKET_DEVICE_TOKEN,ca:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined})();
  if(typeof result.settings?.systemPrompt!=='string'||result.settings?.channels?.length!==4)throw Error('后端返回的配置格式不兼容');
  console.log('AI 配置读取成功：四频道完整，持久保存 '+(result.persistent?'已启用':'未启用'));
} catch(error) { console.error('AI 配置检查失败：'+error.message);process.exitCode=1; }
JS
