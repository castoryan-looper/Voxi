"""Factory-only firmware: do not flash Arduino's unused OTA-data initializer.
Its default 0xe000 address overlaps this board's existing NVS partition.
Keep the NVS layout unchanged to preserve Pocket/Voxi settings.
"""
from pathlib import Path
Import('env')
rows=(Path(env['PROJECT_DIR'])/'partitions.csv').read_text().splitlines()
assert any(row.startswith('factory,app,factory,') for row in rows)
assert not any(',ota,' in row or ',ota_0,' in row for row in rows if not row.startswith('#'))
images=[(offset,path) for offset,path in env.get('FLASH_EXTRA_IMAGES',[]) if Path(path).name!='boot_app0.bin']
env.Replace(FLASH_EXTRA_IMAGES=images)
for offset,path in images:
    address=int(str(offset),0)
    assert not 0x9000 <= address < 0x10000, 'Upload image overlaps persistent NVS/PHY data'
