#!/usr/bin/env bash
# Inspect only safe metadata. Never print the internal Pocket bearer or task text.
set -Eeuo pipefail
docker exec -i voxi-gateway-1 node --input-type=module <<'JS'
import {readFileSync} from 'node:fs';
import {pocketSettings} from './pocket-settings.mjs';
if(process.env.MODE!=='pocket')throw Error('Voxi must already use Pocket mode');
const connection={url:process.env.POCKET_URL,token:process.env.POCKET_DEVICE_TOKEN,ca:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined};
const status=await pocketSettings(connection,'agent')();
if(!Array.isArray(status.connections)||!Array.isArray(status.channelOverrides))throw Error('Upgrade Pocket backend for OpenClaw channel connections');
if(status.runtime.userPortalVersion!==1)throw Error('Upgrade Pocket backend for owner-scoped user portal');
if(status.runtime.voicePreviewVersion!==4)throw Error('Upgrade Pocket backend for RPC voice previews with a two-clip probe');
const library=await pocketSettings(connection,'voice-preview')({action:'status'});
console.log(JSON.stringify({ok:true,revision:process.env.REVISION,enabled:status.settings.enabled,engine:status.runtime.engine,credentialMode:status.runtime.credentialMode,userPortalVersion:status.runtime.userPortalVersion,voicePreviewVersion:status.runtime.voicePreviewVersion,voiceLibrary:{probe:library.probe,mode:library.mode,ready:library.ready,total:library.total,samplesReady:library.samplesReady,samplesTotal:library.samplesTotal,partial:library.partial,failed:library.failed,running:library.running,current:library.current,currentLanguage:library.currentLanguage,blockedReason:library.blockedReason},externalOpenClaw:status.runtime.externalOpenClaw,connections:status.connections.length,channelOverrides:status.channelOverrides.length,providerKeysActive:status.runtime.providerKeysActive,credentials:status.credentials,users:status.users.length,tasks:status.usage.tasks},null,2));
JS
