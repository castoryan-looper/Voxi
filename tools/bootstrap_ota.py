"""One-time USB migration. Preserves NVS/PHY; destroys disposable recording cache."""
import argparse, subprocess, sys, struct, zlib
from pathlib import Path
from publish_firmware import TARGETS, validate_image

def initial_otadata():
    return struct.pack('<I20sII',1,b'\xff'*20,2,zlib.crc32(struct.pack('<I',1),0xffffffff))+b'\xff'*(8192-32)

OTA_MIGRATION_ENABLED=False

def main():
    if not OTA_MIGRATION_ENABLED:
        raise SystemExit("OTA withdrawn by user; migration is disabled. See docs/OTA-WITHDRAWN.md.")
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port',required=True);p.add_argument('--target',choices=TARGETS,required=True)
    p.add_argument('--backup-dir',type=Path,required=True)
    p.add_argument('--erase-recording-cache',action='store_true',required=True)
    p.add_argument('--rom-backup',action='store_true',help='Use ROM-only reads if the USB flasher stub stalls during backup')
    a=p.parse_args();root=Path(__file__).resolve().parents[1]
    built=root/'firmware-c6/.pio/build'/a.target
    for name in ('bootloader.bin','partitions.bin','firmware.bin'):
        if not (built/name).is_file():p.error('Build the OTA target first: '+name)
    validate_image(built/'firmware.bin',a.target)
    a.backup_dir.mkdir(parents=True,exist_ok=False)
    command=[sys.executable,'-m','esptool','--chip','esp32s3','--port',a.port]
    def run(*args,after='no-reset',rom=False):
        subprocess.run(command+(['--no-stub'] if rom else [])+['--after',after]+list(map(str,args)),check=True)
    # These backups contain credentials. Never commit/upload them.
    run('read-flash','0x8000','0x8000',a.backup_dir/'partitions-nvs-phy.bin',rom=a.rom_backup)
    if (a.backup_dir/'partitions-nvs-phy.bin').stat().st_size!=0x8000:
        raise RuntimeError('Incomplete backup; device has not been erased')
    mb,_=TARGETS[a.target];storage=0x610000 if mb==8 else 0x810000
    run('erase-region',hex(storage),hex(mb*1024*1024-storage))
    # Select app0 VALID explicitly, so the first online upgrade has a known-good fallback.
    ota=a.backup_dir/'ota-initial.bin'
    ota.write_bytes(initial_otadata())
    run('write-flash','0x0',built/'bootloader.bin','0x8000',built/'partitions.bin','0x10000',built/'firmware.bin',hex(mb*1024*1024-8192),ota,after='hard-reset')
if __name__=='__main__':main()
