"""Capture allowlisted USB link metrics; never save config or audio contents.

Example: python tools/capture_device_link.py COM15 --seconds 240 --output link.jsonl
Polling refreshes device activity; stop this tool before standby testing.
"""
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import serial

FIELDS = (
    'deviceId', 'uptimeMs', 'networkMode', 'wifiConnected', 'cloudReady', 'busy',
    'connectionStage', 'turnFailure', 'turnFailureAtMs', 'replyReceivedBytes',
    'replyConsumedBytes', 'replyWireReceivedBytes', 'replyIntegrityComplete',
    'replyIntegrityPassed', 'replyGapMaxMs', 'playbackBufferedMs',
    'playbackRebuffers', 'playbackTargetMs', 'playbackResumeMs',
    'playbackCreditActive', 'opusDecodeErrors', 'speakerWriteErrors',
    'cellularRxBytes', 'cellularTxBytes', 'cellularTcpBufferedBytes',
    'cellularRxOverflows', 'cellularResourcesActive', 'cellularSignal',
    'cellularTcpConnected', 'cellularTlsVerified', 'cellularLinkFailure',
    'cellularLinkFailureAtMs', 'networkLoopMaxMs', 'networkSendMaxMs',
    'rxBackpressureActive', 'rxBackpressureMaxMs', 'internalFreeHeap',
    'internalLargestFreeBlock',
)
COUNTERS = ('cellularRxBytes', 'cellularTxBytes', 'replyWireReceivedBytes',
            'replyReceivedBytes', 'replyConsumedBytes')


def status(port):
    ident = str(time.monotonic_ns())
    port.write((json.dumps({'type': 'voxi_config', 'id': ident,
                           'method': 'status', 'body': {}}) + '\n').encode())
    deadline = time.monotonic() + 5
    partial = b''
    while time.monotonic() < deadline:
        partial += port.readline()
        if len(partial) > 65536:
            partial = b''
        if not partial.endswith(b'\n'):
            continue
        line = partial.decode('utf-8', 'replace').strip()
        partial = b''
        at = line.find('VOXI_USB ')
        if at < 0:
            continue
        try:
            response = json.loads(line[at + 9:])
        except ValueError:
            continue
        if str(response.get('id')) == ident:
            if response.get('status') != 200:
                raise RuntimeError('Device status rejected')
            return response.get('data', {})
    raise TimeoutError('USB status timed out')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('port', nargs='?', default='COM15')
    parser.add_argument('--seconds', type=float, default=240)
    parser.add_argument('--interval', type=float, default=1)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 3600 or not .5 <= args.interval <= 30:
        parser.error('seconds must be 1..3600, interval .5..30')
    output = None
    port = serial.Serial(port=None, baudrate=115200, timeout=.2, write_timeout=3)
    port.dtr, port.rts = True, False
    port.port = args.port
    try:
        # Never silently overwrite a previous run.
        if args.output:
            output = args.output.open('x', encoding='utf-8')
        previous = None
        end = time.monotonic() + args.seconds
        with port:
            while time.monotonic() < end:
                began = time.monotonic()
                row = {'atUtc': datetime.now(timezone.utc).isoformat()}
                try:
                    data = status(port)
                    row.update({key: data.get(key) for key in FIELDS})
                    same_boot = previous and data.get('uptimeMs', 0) > previous.get('uptimeMs', 0)
                    row['delta'] = {
                        key: data[key] - previous[key]
                        if same_boot and isinstance(data.get(key), int)
                        and isinstance(previous.get(key), int) and data[key] >= previous[key]
                        else None for key in COUNTERS
                    }
                    previous = data
                except (TimeoutError, RuntimeError) as error:
                    row['sampleError'] = type(error).__name__
                text = json.dumps(row, ensure_ascii=False)
                print(text, flush=True)
                if output:
                    output.write(text + '\n')
                    output.flush()
                time.sleep(max(0, min(end - time.monotonic(), args.interval - (time.monotonic() - began))))
    except KeyboardInterrupt:
        pass
    finally:
        port.close()
        if output:
            output.close()


if __name__ == '__main__':
    main()
