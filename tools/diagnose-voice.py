"""Run inside the Pocket container as its regular UID; no service changes."""
import asyncio
import json
import re
import sys
sys.path.insert(0, '/app/bridge')


def safe_text(value):
    text = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
    text = re.sub(r'-----BEGIN[\s\S]*?-----END[^-]*-----', '[certificate redacted]', text)
    text = re.sub(r'(?im)^[vamco]=.*$', '[SDP redacted]', text)
    text = re.sub(r'(?i)bearer\s+[^\s\"\']+', 'Bearer [redacted]', text)
    text = re.sub(r'(?i)((?:[\"\']?)(?:access_token|refresh_token|id_token|token|authorization|password|api_key|secret)(?:[\"\']?)\s*[:=]\s*)(?:\"[^\"]*\"|\'[^\']*\'|[^\s,;}]+)', r'\1[redacted]', text)
    text = re.sub(r'https?://[^\s\"\'<>]+', '[URL redacted]', text)
    text = re.sub(r'[A-Za-z0-9_+/=.-]{40,}', '[opaque value redacted]', text)
    text = re.sub(r'[\w.+-]+@[\w.-]+', '[email redacted]', text)
    return text.replace('\r', ' ').replace('\n', ' ')[:1200]


async def main():
    import voxi
    original = voxi.VoiceSession.notification

    async def notification(self, packet):
        if packet.get('method') in ('thread/realtime/error', 'thread/realtime/closed'):
            params = packet.get('params') or {}
            print('Upstream event:', packet['method'], flush=True)
            for key in ('message', 'error', 'reason', 'code'):
                if key in params:
                    print(key+':', safe_text(params[key]), flush=True)
        await original(self, packet)
    voxi.VoiceSession.notification = notification

    class Socket:
        closed = False
        async def send_json(self, packet):
            if packet.get('type') in ('connecting', 'ready', 'error'):
                print('State:', safe_text(packet), flush=True)
        async def close(self):
            self.closed = True

    session = voxi.VoiceSession(Socket(), 'codex')
    try:
        await asyncio.wait_for(session.start(), 65)
        print('Native voice READY', flush=True)
    except Exception as error:
        print('Failed phase:', session.phase, flush=True)
        print('Error:', type(error).__name__, safe_text(error), flush=True)
    finally:
        await session.stop()


if __name__ == '__main__':
    asyncio.run(main())
