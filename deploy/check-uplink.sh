#!/usr/bin/env bash
set -euo pipefail
docker exec "${1:-voxi-gateway-1}" node --input-type=module -e '
import {OpusDownlink} from "./opus.mjs";
import {UplinkDecoder,UPLINK_FORMAT} from "./uplink.mjs";
const encoder=new OpusDownlink(),decoder=new UplinkDecoder();
try {
 encoder.reset();decoder.reset(UPLINK_FORMAT);
 const frames=[...encoder.audio(Buffer.alloc(960)),...encoder.finish()];
 const bundle=Buffer.alloc(5+44*frames.length);bundle[4]=frames.length;
 frames.forEach((frame,i)=>{const at=5+44*i;bundle.writeUInt16LE(i===0?480:0,at);bundle.writeUInt16LE(40,at+2);frame.copy(bundle,at+4,4);});
 const pcm=decoder.audio(bundle);decoder.finish();
 if(pcm.length!==1920||decoder.originalSamples!==480)throw Error("Uplink self-test failed");
 console.log(JSON.stringify({ok:true,revision:process.env.REVISION,uplinkFormat:UPLINK_FORMAT,audioBitrate:16000,wireBytesPerSecond:2250}));
} finally {encoder.close();decoder.close();}
'
