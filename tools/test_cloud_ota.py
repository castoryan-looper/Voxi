import json, tempfile, unittest, runpy, struct
from bootstrap_ota import initial_otadata
import bootstrap_ota
from unittest.mock import patch
from pathlib import Path
from publish_firmware import publish, TARGETS
from test_flash_layout import Environment, SCRIPT
ROOT=Path(__file__).resolve().parents[1]
class OtaTests(unittest.TestCase):
 def test_initial_boot_has_a_valid_app0_for_first_update_rollback(self):
  data=initial_otadata();self.assertEqual(len(data),8192)
  seq,label,state,crc=struct.unpack('<I20sII',data[:32])
  self.assertEqual((seq,state,crc),(1,2,0x4743989a))
  self.assertEqual(data[32:],b'\xff'*(8192-32))

 def test_dual_slots_preserve_nvs_and_recording_capacity(self):
  for mb in (8,16):
   name=f'partitions-ota-{mb}m.csv';parts={};end=0
   for line in (ROOT/'firmware-c6'/name).read_text().splitlines():
    if line.startswith('#'): continue
    label,kind,sub,offset,size,*_=line.split(',');start=int(offset,0);length=int(size,0)
    self.assertGreaterEqual(start,end);end=start+length;parts[label]=(kind,sub,start,length)
   self.assertEqual(end,mb*1024*1024);self.assertEqual(parts['nvs'][2:],(0x9000,0x6000));self.assertEqual(parts['phy_init'][2:],(0xf000,0x1000))
   self.assertEqual(parts['app0'][3],parts['app1'][3]);self.assertEqual(parts['otadata'][3],0x2000)
   self.assertGreater(parts['storage'][3],960000+65536)
   env=Environment(PROJECT_DIR=str(ROOT/'firmware-c6'),PARTITION_FILE=name,FLASH_EXTRA_IMAGES=[('0xe000','boot_app0.bin')])
   runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env});self.assertEqual(env['FLASH_EXTRA_IMAGES'],[])
 def test_publisher_checks_chip_target_and_preserves_active_release_on_error(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);image=root/'app.bin';target='waveshare_s3g_ota'
   data=bytearray(4096);data[0]=0xe9;data[12]=9;tag=b'VOXI_OTA_IMAGE:'+target.encode()+b'\0';data[100:100+len(tag)]=tag;image.write_bytes(data)
   result=publish(image,root/'releases',target,'1.0');folder=root/'releases'/target
   self.assertEqual(json.loads((folder/'manifest.json').read_text()),result)
   self.assertEqual((folder/(result['sha256']+'.bin')).read_bytes(),data)
   with self.assertRaises(ValueError):publish(image,root/'releases','zhengchen_minicam_20_ota','1.0')
   data[12]=13;image.write_bytes(data)
   with self.assertRaises(ValueError):publish(image,root/'releases',target,'2.0')
   self.assertEqual(json.loads((folder/'manifest.json').read_text()),result)

 def test_rom_backup_finishes_before_erase_and_never_erases_nvs(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);target='zhengchen_minicam_20_ota';built=root/'firmware-c6/.pio/build'/target;built.mkdir(parents=True)
   data=bytearray(512);data[0]=0xe9;data[12]=9;tag=b'VOXI_OTA_IMAGE:'+target.encode()+b'\0';data[100:100+len(tag)]=tag
   (built/'firmware.bin').write_bytes(data)
   for name in ('bootloader.bin','partitions.bin'):(built/name).write_bytes(b'fixture')
   backup=root/'backup';calls=[]
   def run(command,check):
    calls.append(command)
    if 'read-flash' in command:Path(command[-1]).write_bytes(b'\xff'*0x8000)
   args=['bootstrap_ota.py','--port','COM_TEST','--target',target,'--backup-dir',str(backup),'--erase-recording-cache','--rom-backup']
   with patch.object(bootstrap_ota,'__file__',str(root/'tools/bootstrap_ota.py')),patch('sys.argv',args),patch.object(bootstrap_ota.subprocess,'run',side_effect=run):bootstrap_ota.main()
   self.assertEqual(len(calls),3);self.assertIn('--no-stub',calls[0]);self.assertNotIn('--no-stub',calls[1]);self.assertNotIn('--no-stub',calls[2])
   self.assertEqual(calls[1][-3:],['erase-region','0x810000','0x7f0000'])
   self.assertIn('0xffe000',calls[2]);self.assertNotIn('0xe000',calls[2])
   self.assertEqual((backup/'ota-initial.bin').read_bytes(),initial_otadata())

if __name__=='__main__':unittest.main()
