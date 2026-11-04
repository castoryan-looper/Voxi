"""Exercise the ESP32 encoder, then decode its actual packets in Node/libopus."""
import json,sys,time,serial,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1]
s=serial.Serial(port=None,baudrate=115200,timeout=.3,write_timeout=3)
s.dtr=False;s.rts=False;s.port=sys.argv[1] if len(sys.argv)>1 else 'COM15'
with s:
 def request(method):
  ident=str(time.monotonic_ns());s.write((json.dumps(dict(type='voxi_config',id=ident,method=method,body={}))+'\n').encode());deadline=time.monotonic()+12;partial=b''
  while time.monotonic()<deadline:
   partial+=s.readline()
   if not partial.endswith(b'\n'):continue
   line=partial.decode('utf-8','replace').strip();partial=b''
   if not line.startswith('VOXI_USB '):
    if any(word in line for word in ['assert failed','Guru Meditation','Backtrace:','abort()','stack overflow','ESP-ROM','rst:','VOXI_BOOT']):print(line,flush=True)
    continue
   try:r=json.loads(line[9:])
   except ValueError:continue
   if str(r.get('id'))==ident:return r
  raise TimeoutError(method)
 def rpc(method):
  for attempt in range(3):
   try:return request(method)
   except TimeoutError:
    if attempt==2:raise
    print('USB response retry: '+method,flush=True)
 deadline=time.monotonic()+65
 while True:
  response=rpc('status');d=response['data']
  if d.get('cloudReady') and not d.get('busy'):break
  if time.monotonic()>deadline:raise TimeoutError('Wait for idle READY')
  time.sleep(1)
 print(json.dumps({k:d.get(k) for k in ['deviceId','networkMode','cloudReady','uplinkOpusReady','freeHeap','minFreeHeap']},ensure_ascii=False),flush=True)
 r=rpc('uplink_probe');assert r['status']==200,r
 fixture=r['data'];assert fixture['encoded'] and fixture['errors']==0,fixture
 print(json.dumps({k:fixture[k] for k in ['encoded','frames','errors','maxUs','wireBytes']}),flush=True)
 js='''import {UplinkDecoder,UPLINK_FORMAT} from './uplink.mjs';
 let text='';for await(const part of process.stdin)text+=part;
 const fixture=JSON.parse(text),decoder=new UplinkDecoder();decoder.reset(UPLINK_FORMAT);
 try{let pcm=Buffer.concat(fixture.packets.map(hex=>decoder.audio(Buffer.from(hex,'hex'))));decoder.finish();
 if(decoder.originalSamples!==4800||pcm.length!==10560)throw Error('Unexpected audio length');
 let energy=0;for(let i=960;i<pcm.length;i+=2)energy+=pcm.readInt16LE(i)**2;
 const rms=Math.sqrt(energy/((pcm.length-960)/2));if(rms<1000)throw Error('Encoded voice became silence');
 let tailEnergy=0;for(let i=pcm.length-960;i<pcm.length;i+=2)tailEnergy+=pcm.readInt16LE(i)**2;
 const tailRms=Math.sqrt(tailEnergy/480);if(tailRms<500)throw Error('Last encoded syllable was not drained');
 console.log(JSON.stringify({ok:true,originalSamples:decoder.originalSamples,decodedPcmBytes:pcm.length,wireBytes:decoder.wireBytes,rms,tailRms}));
 }finally{decoder.close();}'''
 result=subprocess.run(['node','--input-type=module','-e',js],cwd=root/'gateway',input=json.dumps(fixture),text=True,encoding='utf-8',capture_output=True,check=True)
 print(result.stdout.strip())
 status=rpc('status')['data'];print(json.dumps({k:status.get(k) for k in ['cloudReady','uplinkOpusReady','opusUplinkFrames','opusUplinkErrors','freeHeap','minFreeHeap','cellularLinkFailure','cellularRemoteCloseCode']},ensure_ascii=False),flush=True)
