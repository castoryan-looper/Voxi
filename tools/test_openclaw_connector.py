import importlib.util
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import unittest

spec=importlib.util.spec_from_file_location('connector',Path(__file__).parents[1]/'gateway'/'voxi-openclaw.py')
connector=importlib.util.module_from_spec(spec);spec.loader.exec_module(connector)


class ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.calls=[];self.events=[]
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_GET(self):
                owner.calls.append(('GET',self.path,None))
                self.send_response(200);self.end_headers();self.wfile.write(b'{"data":[{"id":"openclaw"}]}')
            def do_POST(self):
                body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.calls.append(('POST',self.path,body,dict(self.headers)))
                self.send_response(200);self.end_headers()
                for event in owner.events:self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode())
                self.wfile.write(b'data: [DONE]\n\n')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
        self.job={'id':'job','text':'read only','session':'voxi-isolated-session','agent':'writer','timeout':5}
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def test_probe_is_non_inference_and_worker_forwards_agent_session(self):
        client=connector.opener();self.assertEqual(connector.probe(client,self.url,'fixture-token'),'ready')
        self.assertEqual(self.calls,[('GET','/v1/models',None)])
        self.events=[{'type':'response.output_text.delta','delta':'a'}, {'type':'response.completed','response':{'status':'completed'}}]
        result=connector.execute(client,self.url,'fixture-token',self.job)
        self.assertEqual(result,{'state':'completed','result':'a'})
        request=self.calls[1]
        self.assertEqual(request[2],{'model':'openclaw','input':'read only','stream':True})
        headers={k.lower():v for k,v in request[3].items()}
        self.assertEqual(headers['x-openclaw-session-key'],'voxi-isolated-session')
        self.assertEqual(headers['x-openclaw-agent-id'],'writer')
        self.assertNotIn('fixture-token',json.dumps(result))
    def test_prose_without_terminal_and_incomplete_are_not_success(self):
        self.events=[{'type':'response.output_text.delta','delta':'done'}]
        self.assertEqual(connector.execute(connector.opener(),self.url,'fixture',self.job)['state'],'delivery_unknown')
        self.events=[{'type':'response.incomplete','response':{'status':'incomplete'}}]
        self.assertEqual(connector.execute(connector.opener(),self.url,'fixture',self.job)['state'],'failed')


if __name__=='__main__':unittest.main()
