"""Install an existing Pocket device bearer without exposing it to the terminal."""
import os
from pathlib import Path
import sys

token=sys.stdin.read().strip()
if not 16 <= len(token) <= 256 or any(c.isspace() or c in '#$"\'' for c in token):
    raise SystemExit('Invalid Pocket device bearer; configuration unchanged')
path=Path('/etc/voxi/gateway.env')
lines=path.read_text().splitlines()
updates={'MODE':'pocket','POCKET_URL':'ws://pocket-backend:8789/voxi','POCKET_DEVICE_TOKEN':token}
lines=[s for s in lines if s.split('=',1)[0] not in updates]
text='\n'.join(lines+[f'{k}={v}' for k,v in updates.items()])+'\n'
temp=path.with_suffix('.env.tmp')
with os.fdopen(os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),'w') as stream:
    stream.write(text)
os.chmod(temp,0o600)
temp.replace(path)
print('Pocket native voice configured; device/account secrets were not printed')
