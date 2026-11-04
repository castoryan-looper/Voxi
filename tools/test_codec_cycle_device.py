"""Exercise actual encoder -> gateway decode -> reply decode, over three cycles.

Idle-only USB probes, synthetic audio only; no microphone or model invocation.
Install gateway dependencies and pyserial, then pass the verified serial port.
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import serial

root = Path(__file__).resolve().parents[1]
js = '''import {OpusDownlink} from './opus.mjs';
const encoder=new OpusDownlink();encoder.reset();const pcm=Buffer.alloc(960);
for(let i=0;i<480;i++)pcm.writeInt16LE(Math.round(10000*Math.sin(2*Math.PI*440*i/24000)),i*2);
console.log(JSON.stringify({packet:encoder.audio(pcm)[0].toString('hex')}));encoder.close();'''
reply = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', js], cwd=root/'gateway'))
decode = '''import {UplinkDecoder,UPLINK_FORMAT} from './uplink.mjs';
let text='';for await(const part of process.stdin)text+=part;
const fixture=JSON.parse(text),d=new UplinkDecoder();d.reset(UPLINK_FORMAT);
try{const pcm=Buffer.concat(fixture.packets.map(h=>d.audio(Buffer.from(h,'hex'))));d.finish();
if(d.originalSamples!==4800||pcm.length!==10560)throw Error('duration/tail mismatch');
let energy=0;for(let i=pcm.length-960;i<pcm.length;i+=2)energy+=pcm.readInt16LE(i)**2;
if(Math.sqrt(energy/480)<500)throw Error('tail audio missing');
console.log(JSON.stringify({samples:d.originalSamples,decodedBytes:pcm.length,wireBytes:d.wireBytes}));
}finally{d.close();}'''
s = serial.Serial(port=None, baudrate=115200, timeout=.3, write_timeout=3)
s.dtr = False
s.rts = False
s.port = sys.argv[1]


def rpc(method, body=None):
    ident = str(time.monotonic_ns())
    s.write((json.dumps({'type':'voxi_config', 'id':ident, 'method':method, 'body':body or {}})+'\n').encode())
    deadline = time.monotonic()+20
    partial = b''
    while time.monotonic() < deadline:
        partial += s.readline()
        if not partial.endswith(b'\n'):
            continue
        line = partial.decode('utf-8', 'replace').strip()
        partial = b''
        if not line.startswith('VOXI_USB '):
            continue
        try:
            result = json.loads(line[9:])
        except ValueError:
            continue
        if str(result.get('id')) == ident:
            assert result['status'] == 200, result
            return result['data']
    raise TimeoutError(method)


with s:
    before = rpc('status')
    assert before.get('cloudReady') and not before.get('busy'), 'Wait for idle READY'
    assert before.get('uplinkOpusReady') and before.get('replyCodecConfirmed')
    for cycle in range(3):
        encoded = rpc('uplink_probe')
        assert encoded.get('encoded') and encoded.get('errors') == 0
        assert not rpc('status').get('opusUplinkWorkerActive'), 'Encoder resources leaked after finish'
        decoded = subprocess.check_output(['node', '--input-type=module', '-e', decode],
            cwd=root/'gateway', input=json.dumps(encoded).encode())
        reply_result = rpc('opus_probe', reply)
        assert reply_result.get('decoded') and reply_result.get('samples') == 480 and reply_result.get('peak', 0) > 1000
        status = rpc('status')
        assert status.get('playbackMemoryAllocated'), 'Reply memory was not restored'
        assert status.get('deviceId') == before.get('deviceId')
        assert status.get('cloudReady') and status.get('replyCodecConfirmed'), 'Link lost during codec cycle'
        print(json.dumps({'cycle':cycle+1, 'uplinkMaxUs':encoded['maxUs'],
            'gateway':json.loads(decoded), 'downlinkMaxUs':reply_result['decodeMaxUs'],
            'freeHeap':status.get('freeHeap'), 'cloudReady':status.get('cloudReady')}), flush=True)
