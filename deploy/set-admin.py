"""Set a running gateway account using hidden terminal input, never argv secrets."""
import getpass
import hashlib
import json
import re
import secrets
import subprocess
import sys

def main():
    username = sys.argv[1] if len(sys.argv) == 2 else input('Username: ').strip()
    if not re.fullmatch(r'[A-Za-z0-9_.@-]{1,64}', username):
        raise SystemExit('Invalid username')
    password = getpass.getpass('Password: ')
    if not 8 <= len(password) <= 128:
        raise SystemExit('Password must contain 8–128 characters')
    if password != getpass.getpass('Confirm password: '):
        raise SystemExit('Passwords differ; account unchanged')
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()
    account = {'username': username, 'passwordHash': f'scrypt:{salt}:{digest}'}
    script = """const fs=require('node:fs');let raw='';process.stdin.on('data',p=>raw+=p);process.stdin.on('end',()=>{const a=JSON.parse(raw);const p=process.env.ADMIN_STATE_FILE;if(!p)throw Error('Persistent state not configured');const f=p+'.account';fs.writeFileSync(f+'.tmp',JSON.stringify(a)+'\\n',{mode:0o600});fs.renameSync(f+'.tmp',f);});"""
    subprocess.run(['docker','exec','-i','voxi-gateway-1','node','-e',script],input=json.dumps(account),text=True,check=True)
    subprocess.run(['docker','restart','voxi-gateway-1'],check=True,stdout=subprocess.DEVNULL)
    print(f'Administrator account set: {username}. Previous management sessions are signed out.')

if __name__ == '__main__':
    main()
