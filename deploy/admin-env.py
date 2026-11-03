"""Provision an independent admin secret, preserving all existing credentials."""
import os
import hashlib
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

lines = path.read_text().splitlines()
if not any(line.startswith('ADMIN_PASSWORD_HASH=') and line.split('=', 1)[1].strip() for line in lines):
    password = secrets.token_urlsafe(24)
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    lines = [line for line in lines if not line.startswith(('ADMIN_USERNAME=', 'ADMIN_PASSWORD_HASH=', 'ADMIN_INITIAL_PASSWORD='))]
    lines += ['ADMIN_USERNAME=admin', 'ADMIN_PASSWORD_HASH=scrypt:' + salt + ':' + digest, 'ADMIN_INITIAL_PASSWORD=' + password]
    temporary = path.with_suffix('.admin.tmp')
    with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as stream:
        stream.write('\n'.join(lines) + '\n')
    temporary.replace(path)
    print('Administrator account provisioned; initial password was not printed')
