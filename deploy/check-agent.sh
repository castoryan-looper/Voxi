#!/usr/bin/env bash
# Inspect only safe metadata. Never print the internal Pocket bearer or task text.
set -Eeuo pipefail
docker exec -i voxi-gateway-1 node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {pocketSettings} from './pocket-settings.mjs';
if(process.env.MODE!=='pocket')throw Error('Voxi must already use Pocket mode');
const status=await pocketSettings({url:process.env.POCKET_URL,token:process.env.POCKET_DEVICE_TOKEN,ca:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined},'agent')();
console.log(JSON.stringify({ok:true,revision:process.env.REVISION,enabled:status.settings.enabled,engine:status.runtime.engine,credentialMode:status.runtime.credentialMode,providerKeysActive:status.runtime.providerKeysActive,credentials:status.credentials,users:status.users.length,tasks:status.usage.tasks},null,2));
JS
