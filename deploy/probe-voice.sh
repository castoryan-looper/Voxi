#!/usr/bin/env bash
# Generate at most the two fixed Cove clips, then print safe diagnostics.
set -Eeuo pipefail
probe_status=0
docker exec -i voxi-gateway-1 node --input-type=module <<'JS' || probe_status=$?
import {readFileSync} from 'node:fs';
import {pocketSettings} from './pocket-settings.mjs';
if(process.env.MODE!=='pocket')throw Error('Voxi must use Pocket mode');
const connection={url:process.env.POCKET_URL,token:process.env.POCKET_DEVICE_TOKEN,
 ca:process.env.POCKET_CA_FILE?readFileSync(process.env.POCKET_CA_FILE):undefined};
const agent=await pocketSettings(connection,'agent')();
if(agent.runtime?.voicePreviewVersion!==5)throw Error('Pocket voice preview version 5 is not deployed yet; rerun upgrade-pocket-agent.py and check-agent.sh');
const api=pocketSettings(connection,'voice-preview');
let status=await api({action:'probe'}),last='',started=Date.now();
while(true){
 const safe={version:agent.runtime.voicePreviewVersion,probe:status.probe,running:status.running,
  mode:status.mode,current:status.current,language:status.currentLanguage,stage:status.stage,
  waitingForCapacity:status.waitingForCapacity,blockedReason:status.blockedReason,
  samples:status.voices?.find(v=>v.id==='cove')?.samples};
 const value=JSON.stringify(safe);
 if(value!==last){console.log(value);last=value;}
 if(status.probe?.passed){console.log('Cove Chinese and English recordings passed automatic language and meaning checks. Listen in the voice page before preparing all voices.');break;}
 if(!status.running||Date.now()-started>360000){
  console.log('Probe did not pass. Full-library generation remains gated. Share the JSON above and the matching preview logs; no credentials are needed.');process.exitCode=1;break;
 }
 await new Promise(resolve=>setTimeout(resolve,2000));status=await api({action:'status'});
}
JS
if (( probe_status != 0 )); then
  docker logs --since=5m --timestamps codex-pocket-gateway-1 2>&1 \
    | grep -E 'Voxi preview failed|Native voice preview failure|Voxi meaning review failed' | tail -n 24 || true
fi
exit "$probe_status"
