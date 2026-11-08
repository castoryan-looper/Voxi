#!/usr/bin/env python3
"""Voxi home connector. Python 3.10+, standard library only.

OpenClaw Gateway token stays on this computer. No inbound port is opened.
Never retry executing a claimed task; only retry delivering its saved result.
"""
import argparse
import getpass
import json
import os
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):return None


def opener(ca=None):
    return urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),
                urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=ca)))


def call(client, url, token, body=None, timeout=8, headers=None):
    data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
    request=urllib.request.Request(url,data=data,headers={'Authorization':'Bearer '+token,
                     'Content-Type':'application/json',**(headers or {})})
    return client.open(request,timeout=timeout)


def probe(client, url, token):
    try:
        with call(client,url+'/v1/models',token,timeout=5) as r:
            data=json.loads(r.read(262145))
            return 'ready' if isinstance(data.get('data'),list) else 'endpoint_disabled'
    except urllib.error.HTTPError as e:return {401:'unauthorized',403:'unauthorized',404:'endpoint_disabled'}.get(e.code,'unreachable')
    except Exception:return 'unreachable'


def execute(client, url, token, job):
    result=''
    try:
        with call(client,url+'/v1/responses',token,{'model':'openclaw','input':job['text'],'stream':True},
                  timeout=job['timeout'],headers={'x-openclaw-agent-id':job['agent'],'x-openclaw-session-key':job['session']}) as r:
            while True:
                line=r.readline(262145)
                if not line:break
                if len(line)>262144:raise ValueError('SSE line too large')
                if not line.startswith(b'data:'):continue
                value=line[5:].strip()
                if value==b'[DONE]':break
                event=json.loads(value);kind=event.get('type')
                if kind=='response.output_text.delta':result=(result+str(event.get('delta','')))[-64000:]
                elif kind in ('response.completed','response.failed','response.incomplete'):
                    response=event.get('response') or {}
                    final='\n'.join(p.get('text','') for item in response.get('output',[]) if item.get('type')=='message' for p in item.get('content',[]) if p.get('type')=='output_text')
                    return {'state':'completed' if kind=='response.completed' and response.get('status')=='completed' else 'failed','result':(final or result)[-64000:]}
    except urllib.error.HTTPError as e:
        if e.code in (400,401,403,404,409):return {'state':'failed','result':'OpenClaw 拒绝请求，请检查 Responses API、凭据、Agent ID 和会话。'}
    except Exception:pass
    return {'state':'delivery_unknown','result':result}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server',help='Voxi HTTPS 根地址')
    parser.add_argument('--connection',help='后台生成的连接编号')
    parser.add_argument('--ca',help='Voxi 自签证书的受信 CA 文件；不关闭证书验证')
    parser.add_argument('--local',default='http://127.0.0.1:18789',help='此电脑上的 OpenClaw 根地址')
    args=parser.parse_args()
    server=(args.server or input('Voxi HTTPS 地址：')).rstrip('/')
    p=urlsplit(server);local=urlsplit(args.local)
    if p.scheme!='https' or not p.hostname or p.path or p.query or p.fragment or p.username or p.password:parser.error('Voxi 地址必须是 HTTPS 根地址')
    if local.scheme not in ('http','https') or local.hostname not in ('127.0.0.1','localhost','::1') or local.path not in ('','/') or local.query or local.fragment or local.username or local.password:parser.error('OpenClaw 必须在本机回环地址')
    ident=args.connection or input('连接编号：').strip()
    pair=os.environ.get('VOXI_CONNECTOR_TOKEN') or getpass.getpass('Voxi 连接密钥（后台仅显示一次）：')
    token=os.environ.get('OPENCLAW_GATEWAY_TOKEN') or getpass.getpass('本机 OpenClaw Gateway Token／密码（不会上传）：')
    cloud=opener(args.ca);home=opener();done=queue.Queue();active=None;pending=None;status='unreachable';checked=0
    print('正在连接；保持此窗口运行。Ctrl+C 退出，退出后请核对 OpenClaw 中仍在进行的任务。',flush=True)
    def work(job):done.put((job['id'],execute(home,args.local.rstrip('/'),token,job)))
    while True:
        if time.monotonic()-checked>20:
            status=probe(home,args.local.rstrip('/'),token);checked=time.monotonic()
            print('本机 OpenClaw：'+status,flush=True)
        if not pending:
            try:pending=done.get_nowait()
            except queue.Empty:pass
        body={'connectionId':ident,'status':status,'op':'result' if pending else 'poll','busy':bool(active)}
        if pending:body.update(taskId=pending[0],**pending[1])
        try:
            with call(cloud,server+'/api/openclaw/relay',pair,body) as r:data=json.loads(r.read(65536))
            if pending:print('任务结果已送达。',flush=True);pending=None;active=None
            elif data.get('job'):
                active=data['job']['id']
                print('已接收任务 '+active[:8]+'；工具确认请在 OpenClaw 完成。',flush=True)
                threading.Thread(target=work,args=(data['job'],),daemon=True).start()
        except Exception:print('Voxi 暂未连通；稍后重试传送状态，不会重新执行任务。',flush=True)
        time.sleep(2)


if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('\n连接器已退出。请在 OpenClaw 核对或停止尚未完成的任务。')
