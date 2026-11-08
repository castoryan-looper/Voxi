#!/usr/bin/env bash
# Inspect only safe metadata. Never print the internal Pocket bearer or task text.
set -Eeuo pipefail
docker exec -i voxi-gateway-1 node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {pocketSettings} from './pocket-settings.mjs';
if(process.env.MODE!=='pocket')throw Error('Voxi must already use Pocket mode');
const status=await pocketSettings({url:process.env.POCKET_URL,token:process.env.POCKET_DEVICE_TOKEN,ca:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined},'agent')();
if(!Array.isArray(status.connections)||!Array.isArray(status.channelOverrides))throw Error('Upgrade Pocket backend for OpenClaw channel connections');
if(status.runtime.userPortalVersion!==1)throw Error('Upgrade Pocket backend for owner-scoped user portal');
if(status.runtime.voicePreviewVersion!==1)throw Error('Upgrade Pocket backend for native voice selection and preview');
console.log(JSON.stringify({ok:true,revision:process.env.REVISION,enabled:status.settings.enabled,engine:status.runtime.engine,credentialMode:status.runtime.credentialMode,userPortalVersion:status.runtime.userPortalVersion,voicePreviewVersion:status.runtime.voicePreviewVersion,externalOpenClaw:status.runtime.externalOpenClaw,connections:status.connections.length,channelOverrides:status.channelOverrides.length,providerKeysActive:status.runtime.providerKeysActive,credentials:status.credentials,users:status.users.length,tasks:status.usage.tasks},null,2));
JS
