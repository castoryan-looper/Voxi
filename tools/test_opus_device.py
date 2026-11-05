"""Verify the deployed S3 decoder with a packet from the actual gateway encoder.

Uses only status and the idle-only opus_probe endpoint. Never reads config secrets.
Run with the project's pyserial-enabled Python: tools/test_opus_device.py COM15.
"""
import json
from pathlib import Path
import subprocess
import sys
import time
import serial

root = Path(__file__).resolve().parents[1]
bitrate = int(sys.argv[2]) if len(sys.argv) > 2 else 16000
if bitrate not in (8000, 12000, 16000):
    raise ValueError('Bitrate must be 8000, 12000 or 16000')
js = '''import {OpusDownlink} from './opus.mjs';
const e=new OpusDownlink(BITRATE);e.reset();const pcm=Buffer.alloc(960);
for(let i=0;i<480;i++)pcm.writeInt16LE(Math.round(10000*Math.sin(2*Math.PI*440*i/24000)),i*2);
console.log(JSON.stringify({packet:e.audio(pcm)[0].toString('hex')}));e.close();'''.replace('BITRATE', str(bitrate))
fixture = json.loads(subprocess.check_output(
    ['node', '--input-type=module', '-e', js], cwd=root/'gateway', text=True, encoding='utf-8'))
s = serial.Serial(port=None, baudrate=115200, timeout=.2, write_timeout=3)
s.dtr = False
s.rts = False
s.port = sys.argv[1] if len(sys.argv) > 1 else 'COM15'

def rpc(method, body=None):
    ident = str(time.monotonic_ns())
    s.write((json.dumps({'type': 'voxi_config', 'id': ident, 'method': method, 'body': body or {}})+'\n').encode())
    until = time.monotonic()+12
    while time.monotonic() < until:
        line = s.readline().decode('utf-8', 'replace').strip()
        if not line.startswith('VOXI_USB '):
            continue
        try:
            response = json.loads(line[9:])
        except ValueError:
            continue
        if str(response.get('id')) == ident:
            return response['status'], response.get('data', {})
    raise TimeoutError(method)

with s:
    code, status = rpc('status')
    assert code == 200 and not status.get('busy'), 'Wait for device idle'
    print(json.dumps({k: status.get(k) for k in ['deviceId', 'networkMode', 'talkButton', 'replyTransportFormat', 'cloudReady']}), flush=True)
    code, result = rpc('opus_probe', fixture)
    assert code == 200 and result.get('decoded') and result.get('samples') == 480, result
    assert 1000 < result['peak'] <= 32768, result
    print('Opus gateway-to-S3 decoder passed at '+str(bitrate)+' bps: '+json.dumps(result), flush=True)
    bad = bytearray.fromhex(fixture['packet'])
    bad[0] = 1
    code, result = rpc('opus_probe', {'packet': bad.hex()})
    assert code == 422 and not result.get('decoded'), 'Out-of-order frame accepted'
    code, result = rpc('opus_probe', {'packet': 'not-hex'})
    assert code == 400, 'Malformed frame accepted'
    print('Out-of-order and malformed frame rejection passed', flush=True)
