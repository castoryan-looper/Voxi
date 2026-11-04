#!/usr/bin/env bash
set -euo pipefail
docker exec "${1:-voxi-gateway-1}" node --input-type=module -e '
import {OpusDownlink, OPUS_BITRATE} from "./opus.mjs";
import OpusScript from "opusscript";
const encoder=new OpusDownlink(),decoder=new OpusScript(24000,1,OpusScript.Application.VOIP);
try {
  encoder.reset();const [packet]=encoder.audio(Buffer.alloc(960));
  if(packet.length!==64||packet.readUInt32LE()!==0||decoder.decode(packet.subarray(4)).length!==960)throw Error("Opus self-test failed");
  console.log(JSON.stringify({ok:true,revision:process.env.REVISION,format:"opus-24000-v1",audioBitrate:OPUS_BITRATE,wireBytesPerSecond:packet.length*50}));
} finally {encoder.close();decoder.delete();}
'
