import http from 'node:http';
import {readFileSync} from 'node:fs';

http.createServer((req,res)=>{
  if(req.url==='/shared/theme.css'){
    res.writeHead(200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'});
    res.end(readFileSync(new URL('../gateway/theme.css',import.meta.url)));
    return;
  }
  if(req.url!=='/'&&req.url!=='/setup/'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});res.end(readFileSync(new URL('../gateway/setup.html',import.meta.url)));
}).listen(8788,'127.0.0.1',()=>console.log('Voxi USB settings: http://127.0.0.1:8788/'));
