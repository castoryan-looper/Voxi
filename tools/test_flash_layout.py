import runpy
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('flash_layout.py')
class Environment(dict):
    def Replace(self,**values):self.update(values)
class LayoutTest(unittest.TestCase):
    def test_factory_preserves_nvs_and_phy(self):
        root=Path(__file__).resolve().parents[1]
        env=Environment(PROJECT_DIR=str(root/'firmware-c6'),FLASH_EXTRA_IMAGES=[('0x0','bootloader.bin'),('0x8000','partitions.bin'),('0xe000','boot_app0.bin')])
        runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env})
        self.assertEqual(env['FLASH_EXTRA_IMAGES'],[('0x0','bootloader.bin'),('0x8000','partitions.bin')])
    def test_rejects_other_image_overlapping_nvs(self):
        root=Path(__file__).resolve().parents[1]
        env=Environment(PROJECT_DIR=str(root/'firmware-c6'),FLASH_EXTRA_IMAGES=[('0xa000','unexpected.bin')])
        with self.assertRaises(AssertionError):runpy.run_path(str(SCRIPT),init_globals={'Import':lambda _:None,'env':env})
if __name__=='__main__':unittest.main()
