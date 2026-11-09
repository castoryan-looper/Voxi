"""Install a built application image; manifest replacement enables automatic rollout."""
import argparse, hashlib, json, os, re, tempfile
from pathlib import Path
TARGETS={'waveshare_s3g_ota':(8,0x300000),'waveshare_amoled18_v2_ota':(16,0x400000),'zhengchen_minicam_20_ota':(16,0x400000),'zhengchen_minicam_20_gpio11_ptt_ota':(16,0x400000)}
def validate_image(image, target):
    if target not in TARGETS: raise ValueError('Unsupported target')
    data=Path(image).read_bytes(); _, limit=TARGETS[target]
    if not 256<=len(data)<=limit or data[0]!=0xe9: raise ValueError('Invalid/oversized ESP application image')
    if int.from_bytes(data[12:14],'little')!=9: raise ValueError('Image must target ESP32-S3')
    if b'VOXI_OTA_IMAGE:'+target.encode()+b'\0' not in data: raise ValueError('Image OTA target does not match release target')
    return data

def publish(image, destination, target, version):
    data=validate_image(image,target)
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}',version): raise ValueError('Invalid version')
    digest=hashlib.sha256(data).hexdigest();folder=Path(destination)/target;folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o755)
    def atomic(path, value):
        fd,name=tempfile.mkstemp(dir=folder)
        try:
            with os.fdopen(fd,'wb') as f: f.write(value);f.flush();os.fsync(f.fileno())
            os.chmod(name,0o644);os.replace(name,path)
        finally:
            if os.path.exists(name): os.unlink(name)
    binary=folder/(digest+'.bin')
    if binary.exists():
        if hashlib.sha256(binary.read_bytes()).hexdigest()!=digest: raise ValueError('Existing release corrupted')
    else: atomic(binary,data)
    manifest={'schema':1,'target':target,'version':version,'size':len(data),'sha256':digest}
    atomic(folder/'manifest.json',json.dumps(manifest).encode());return manifest
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--image',required=True);p.add_argument('--destination',required=True);p.add_argument('--target',choices=TARGETS,required=True);p.add_argument('--version',required=True)
    a=p.parse_args();print(json.dumps(publish(a.image,a.destination,a.target,a.version)))
