import http from 'node:http';
import {readFileSync} from 'node:fs';

const assets={
  '/shared/theme.css':['theme.css','text/css; charset=utf-8'],
  '/shared/radio-schematic.svg':['radio-schematic.svg','image/svg+xml'],
};

http.createServer((req,res)=>{
  if(Object.hasOwn(assets,req.url)){
    const [name,type]=assets[req.url];
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(readFileSync(new URL('../gateway/'+name,import.meta.url)));
    return;
  }
  if(req.url!=='/'&&req.url!=='/setup/'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});res.end(readFileSync(new URL('../gateway/setup.html',import.meta.url)));
}).listen(8788,'127.0.0.1',()=>console.log('Voxi USB settings: http://127.0.0.1:8788/'));
