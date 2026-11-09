#!/usr/bin/env python3
"""One-way, opt-in conversation sync. Run setup once per source/project."""
import argparse
from collections import deque
from contextlib import contextmanager
import getpass
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener


ROOT = Path.home() / '.voxi-context'
SECRET = re.compile(r'(?i)\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9_]{16,}|github_pat_[a-z0-9_]{16,}|Bearer\s+[a-z0-9._~+/=-]{16,})')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(url, token, body=None, ca=None, limit=8*1024*1024):
    context = ssl.create_default_context(cafile=ca)
    opener = build_opener(ProxyHandler({}), HTTPSHandler(context=context), NoRedirect())
    headers = {'Authorization':'Bearer '+token,'Accept':'application/json'}
    encoded = None
    if body is not None:
        encoded = json.dumps(body,ensure_ascii=False).encode()
        headers['Content-Type'] = 'application/json'
    try:
        with opener.open(Request(url,data=encoded,headers=headers),timeout=15) as response:
            raw = response.read(limit+1)
    except HTTPError as exc:
        raise RuntimeError(f'HTTP {exc.code}。请检查服务、权限或配对授权') from None
    if len(raw)>limit:
        raise RuntimeError('来源会话过大')
    return json.loads(raw)


def origin(value, *, local_http=False):
    parts=urlsplit(value)
    allowed = parts.scheme=='https' or local_http and parts.scheme=='http' and parts.hostname in ('localhost','127.0.0.1','::1')
    if not allowed or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('','/'):
        raise ValueError('请填写 HTTPS 服务根地址；同机 Open WebUI 可使用 localhost HTTP')
    return value.rstrip('/')


def safe_text(value, limit=1600):
    if isinstance(value,list):
        value='\n'.join(block['text'] for block in value if isinstance(block,dict) and
                        block.get('type') in ('text','input_text','output_text') and isinstance(block.get('text'),str))
    if not isinstance(value,str):
        return ''
    return SECRET.sub('[已隐藏密钥]',value[:limit*2]).strip()[:limit]


def chat(ident, title, updated, rows):
    recent=deque(maxlen=16)
    for role, value in rows:
        text=safe_text(value)
        if role in ('user','assistant') and text and not re.match(r'^</?(?:system-reminder|local-command|command-)',text,re.I):
            recent.append({'role':role,'text':text})
    if not recent:
        return None
    when=int(updated or 0)
    if 0<when<100000000000: when*=1000
    return {'id':str(ident),'title':safe_text(title,120) or next((m['text'][:120] for m in recent if m['role']=='user'),'未命名会话'),
            'updated':when or int(time.time()*1000),'messages':list(recent)}


def within(path, root):
    try:
        return Path(path).resolve().is_relative_to(Path(root).resolve())
    except (OSError,TypeError,ValueError):
        return False


class Codex:
    def __init__(self, executable):
        self.proc=subprocess.Popen([executable,'app-server','--listen','stdio://'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        self.inbox=queue.Queue()
        self.sequence=0
        threading.Thread(target=self.read,daemon=True).start()

    def read(self):
        try:
            while line:=self.proc.stdout.readline(32*1024*1024):
                self.inbox.put(json.loads(line))
        except (ValueError,OSError):
            pass
        finally:
            self.inbox.put(None)

    def send(self, packet):
        self.proc.stdin.write(json.dumps(packet).encode()+b'\n')
        self.proc.stdin.flush()

    def call(self, method, params):
        self.sequence+=1
        ident=self.sequence
        self.send({'id':ident,'method':method,'params':params})
        deadline=time.monotonic()+18
        while time.monotonic()<deadline:
            reply=self.inbox.get(timeout=max(.01,deadline-time.monotonic()))
            if reply is None:
                break
            if reply.get('id')==ident:
                if 'error' in reply:
                    raise RuntimeError('Codex 读取接口未成功：'+method)
                return reply['result']
        raise RuntimeError('Codex 本机会话读取超时')

    def __enter__(self):
        try:
            self.call('initialize',{'clientInfo':{'name':'voxi-context','version':'1.0'}})
            self.send({'method':'initialized','params':{}})
            return self
        except BaseException:
            self.__exit__()
            raise

    def __exit__(self,*_):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self.proc.stdout.close()


def codex_chats(config, checkpoint):
    binary=config.get('codex') or shutil.which('codex')
    if not binary:
        raise RuntimeError('找不到 Codex CLI，请安装 CLI 或指定 --codex')
    project=config['project']
    with Codex(binary) as rpc:
        page=rpc.call('thread/list',{'cwd':project,'sortKey':'updated_at','limit':12,'archived':False,
            'sourceKinds':['cli','vscode','appServer'],'modelProviders':[],'useStateDbOnly':True})
        for thread in page.get('data',[]):
            if not within(thread.get('cwd'),project):
                continue
            ident,updated=thread['id'],thread.get('updatedAt',0)
            if checkpoint.get(ident)==updated:
                continue
            try:
                turns=rpc.call('thread/turns/list',{'threadId':ident,'limit':8,'itemsView':'full'})['data'][::-1]
            except RuntimeError:
                turns=rpc.call('thread/read',{'threadId':ident,'includeTurns':True})['thread']['turns'][-8:]
            rows=[]
            running=False
            for turn in turns:
                if turn.get('status')=='inProgress':
                    running=True
                    continue
                for item in turn.get('items',[]):
                    if item.get('type')=='userMessage':
                        rows.append(('user',item.get('content')))
                    elif item.get('type')=='agentMessage' and item.get('phase') in (None,'final_answer','finalAnswer'):
                        rows.append(('assistant',item.get('text')))
            result=chat(ident,thread.get('name') or thread.get('preview'),updated,rows)
            if result:
                yield result,None if running else updated


def claude_chats(config, checkpoint):
    try:
        from claude_agent_sdk import get_session_messages, list_sessions
    except ImportError:
        raise RuntimeError('请先运行 python -m pip install -U claude-agent-sdk') from None
    project=config['project']
    for entry in list_sessions(directory=project,limit=12):
        if getattr(entry,'cwd',None) and not within(entry.cwd,project):
            continue
        ident,updated=entry.session_id,entry.last_modified
        if checkpoint.get(ident)==updated:
            continue
        rows=((m.type,m.message.get('content')) for m in get_session_messages(ident,directory=project))
        result=chat(ident,getattr(entry,'custom_title',None) or entry.summary,updated,rows)
        if result:
            yield result,updated


def webui_chats(config, checkpoint):
    for ident in config['chat']:
        response=request(config['webui']+'/api/v1/chats/'+quote(ident,safe=''),config['webui_key'])
        updated=response.get('updated_at')
        if updated and checkpoint.get(ident)==updated:
            continue
        value=response['chat']
        history=value.get('history') or {}
        nodes=history.get('messages') or {}
        latest=history.get('currentId')
        recent,seen=[],set()
        while latest and latest not in seen and latest in nodes and len(recent)<64:
            seen.add(latest)
            item=nodes[latest]
            recent.append(item)
            latest=item.get('parentId')
        messages=recent[::-1] or value.get('messages',[])
        rows=((item.get('role'),item.get('content')) for item in messages if item.get('done') is not False)
        result=chat(ident,value.get('title') or response.get('title'),updated,rows)
        if result:
            yield result,None if any(item.get('done') is False for item in messages) else updated


READERS={'codex':codex_chats,'claude-code':claude_chats,'open-webui':webui_chats}


def sync(config, checkpoint):
    def send(body):
        return request(config['server']+'/api/context-sync',config['token'],body,config['ca'],limit=16384)
    send({})
    count=0
    for value, updated in READERS[config['source']](config,checkpoint):
        result=send({'chat':value})
        checkpoint[value['id']]=updated
        count+=bool(result['changed'])
    return count


def protect(value, *, decrypt=False):
    if os.name!='nt':
        return value
    import ctypes
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_=[('size',wintypes.DWORD),('data',ctypes.c_void_p)]
    data=bytes.fromhex(value) if decrypt else value.encode()
    buffer=ctypes.create_string_buffer(data)
    source=Blob(len(data),ctypes.cast(buffer,ctypes.c_void_p))
    result=Blob()
    crypt=ctypes.windll.crypt32
    function=crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    if not function(ctypes.byref(source),None,None,None,None,1,ctypes.byref(result)):
        raise RuntimeError('Windows DPAPI 凭据处理失败')
    try:
        value=ctypes.string_at(result.data,result.size)
        return value.decode() if decrypt else value.hex()
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.c_void_p(result.data))


def config_path(ident):
    if not re.fullmatch(r'[a-f0-9]{16}',ident):
        raise ValueError('配置编号无效')
    return ROOT/(ident+'.json')


def load(ident):
    config=json.loads(config_path(ident).read_text(encoding='utf-8'))
    for field in ('token','webui_key'):
        if config.get(field):config[field]=protect(config[field],decrypt=True)
    return config


def save(ident, config):
    ROOT.mkdir(mode=0o700,exist_ok=True)
    stored=dict(config)
    for field in ('token','webui_key'):
        if stored.get(field):stored[field]=protect(stored[field])
    target=config_path(ident)
    temporary=target.with_suffix(f'.{os.getpid()}.tmp')
    try:
        with os.fdopen(os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w',encoding='utf-8') as file:
            json.dump(stored,file,ensure_ascii=False)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def start_windows(ident):
    if os.name!='nt':
        raise RuntimeError('--startup 目前用于 Windows')
    startup=Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Startup'
    runner=ROOT/'voxi-context-sync.py'
    if runner.resolve()!=Path(__file__).resolve():
        shutil.copyfile(__file__,runner)
    command=[sys.executable,str(runner),'watch',ident]
    literal=subprocess.list2cmdline(command).replace('"','""')
    (startup/f'Voxi-Context-{ident}.vbs').write_text(
        'CreateObject("WScript.Shell").Run "'+literal+'", 0, False\n',encoding='utf-16')
    subprocess.Popen(command,creationflags=subprocess.CREATE_NO_WINDOW,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)


@contextmanager
def watcher_lock(ident):
    path=config_path(ident).with_suffix('.lock')
    with path.open('a+b') as lock:
        lock.seek(0)
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest='command',required=True)
    setup=commands.add_parser('setup')
    setup.add_argument('--server',required=True)
    setup.add_argument('--source',choices=READERS,required=True)
    setup.add_argument('--project')
    setup.add_argument('--codex')
    setup.add_argument('--webui')
    setup.add_argument('--chat',action='append')
    setup.add_argument('--ca')
    setup.add_argument('--startup',action='store_true')
    for command in ('once','watch'):
        commands.add_parser(command).add_argument('id')
    args=parser.parse_args()
    if args.command=='setup':
        config={'server':origin(args.server),'source':args.source,'ca':str(Path(args.ca).resolve()) if args.ca else None}
        if args.startup and os.name!='nt':raise ValueError('--startup 目前用于 Windows')
        if args.source=='open-webui':
            if not args.webui or not args.chat or len(args.chat)>12 or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',c) for c in args.chat):
                raise ValueError('请填写 Open WebUI 地址和明确授权的会话 ID')
            config.update(webui=origin(args.webui,local_http=True),chat=args.chat)
            config['webui_key']=getpass.getpass('Open WebUI API Key（保留在本机）: ').strip()
            if not config['webui_key']:raise ValueError('请输入 Open WebUI API Key')
        else:
            if not args.project or not Path(args.project).is_dir():raise ValueError('请选择存在的项目目录')
            config['project']=str(Path(args.project).resolve())
            config['codex']=args.codex or (shutil.which('codex') if args.source=='codex' else None)
        ident=hashlib.sha256(json.dumps({k:v for k,v in config.items() if k!='webui_key'},sort_keys=True).encode()).hexdigest()[:16]
        config['token']=getpass.getpass('Voxi 配对密钥: ').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{43}',config['token']):raise ValueError('Voxi 配对密钥无效')
        count=sync(config,{})
        save(ident,config)
        if args.startup:start_windows(ident)
        print(f'配对成功。本次更新 {count} 段对话。配置编号 {ident}。')
        if not args.startup: print(f'后台运行命令：python voxi-context-sync.py watch {ident}')
        return
    config=load(args.id)
    if args.command=='once':
        print(f'本次更新 {sync(config,{})} 段对话。')
        return
    with watcher_lock(args.id):
        checkpoint={}
        delay=60
        token=None
        while True:
            try:
                config=load(args.id)
                if config['token']!=token:
                    checkpoint.clear()
                    token=config['token']
                sync(config,checkpoint)
                delay=60
            except Exception as exc:
                print(str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__,file=sys.stderr,flush=True)
                delay=min(delay*2,900)
            time.sleep(delay)


if __name__=='__main__':
    try:
        main()
    except (RuntimeError,ValueError,OSError) as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
