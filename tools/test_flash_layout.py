import runpy
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('flash_layout.py')
class Environment(dict):
    def Replace(self,**values):self.update(values)
    def BoardConfig(self):return {"build.partitions":self.get("PARTITION_FILE","partitions.csv")}
class LayoutTest(unittest.TestCase):
    def test_factory_preserves_nvs_and_phy(self):
        root=Path(__file__).resolve().parents[1]
        env=Environment(PROJECT_DIR=str(root/'firmware-c6'),FLASH_EXTRA_IMAGES=[('0x0','bootloader.bin'),('0x8000','partitions.bin'),('0xe000','boot_app0.bin')],UPLOADERFLAGS=['--chip','esp32c6','write-flash','0x0','bootloader.bin','0x8000','partitions.bin','0xe000','boot_app0.bin'])
        runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env})
        self.assertEqual(env['FLASH_EXTRA_IMAGES'],[('0x0','bootloader.bin'),('0x8000','partitions.bin')])
        self.assertEqual(env['UPLOADERFLAGS'],['--chip','esp32c6','write-flash','0x0','bootloader.bin','0x8000','partitions.bin'])
    def test_s3_color_layout_fits_8mb_and_preserves_nvs(self):
        root=Path(__file__).resolve().parents[1]
        env=Environment(PROJECT_DIR=str(root/'firmware-c6'),PARTITION_FILE='partitions-s3g.csv',FLASH_EXTRA_IMAGES=[('0x0','bootloader.bin'),('0x8000','partitions.bin'),('0xe000','boot_app0.bin')])
        runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env})
        self.assertEqual(len(env['FLASH_EXTRA_IMAGES']),2)
        rows=(root/'firmware-c6/partitions-s3g.csv').read_text().splitlines()
        for row in rows:
            if not row or row.startswith('#'):continue
            fields=row.split(',')
            self.assertLessEqual(int(fields[3],0)+int(fields[4],0),8*1024*1024)

    def test_rejects_other_image_overlapping_nvs(self):
        root=Path(__file__).resolve().parents[1]
        env=Environment(PROJECT_DIR=str(root/'firmware-c6'),FLASH_EXTRA_IMAGES=[('0xa000','unexpected.bin')])
        with self.assertRaises(AssertionError):runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env})
if __name__=='__main__':unittest.main()
