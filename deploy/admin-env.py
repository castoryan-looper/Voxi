"""Provision an independent admin secret, preserving all existing credentials."""
import os
from pathlib import Path
import secrets
import sys

path = Path(sys.argv[1])
lines = path.read_text().splitlines()
if not any(line.startswith('ADMIN_TOKEN=') and line.split('=', 1)[1].strip() for line in lines):
    lines = [line for line in lines if not line.startswith('ADMIN_TOKEN=')]
    lines.append('ADMIN_TOKEN=' + secrets.token_hex(32))
    temporary = path.with_suffix('.admin.tmp')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write('\n'.join(lines) + '\n')
    temporary.replace(path)
    print('Independent admin secret provisioned; no credentials printed')
