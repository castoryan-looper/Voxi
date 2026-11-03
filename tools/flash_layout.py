"""Factory-only firmware: do not flash Arduino's unused OTA-data initializer.
Its default 0xe000 address overlaps this board's existing NVS partition.
Keep the NVS layout unchanged to preserve Pocket/Voxi settings.
"""
from pathlib import Path
Import('env')
rows=(Path(env['PROJECT_DIR'])/env.BoardConfig().get('build.partitions','partitions.csv')).read_text().splitlines()
assert any(row.startswith('factory,app,factory,') for row in rows)
assert not any(',ota,' in row or ',ota_0,' in row for row in rows if not row.startswith('#'))
images=[(offset,path) for offset,path in env.get('FLASH_EXTRA_IMAGES',[]) if Path(path).name!='boot_app0.bin']
env.Replace(FLASH_EXTRA_IMAGES=images)
for offset,path in images:
    address=int(str(offset),0)
    assert not 0x9000 <= address < 0x10000, 'Upload image overlaps persistent NVS/PHY data'

# PlatformIO builds UPLOADERFLAGS before post scripts. Remove the already
# expanded address/file pair as well; changing FLASH_EXTRA_IMAGES alone is late.
flags=list(env.get('UPLOADERFLAGS',[]))
index=len(flags)-1
while index>0:
    if Path(str(flags[index])).name=='boot_app0.bin':
        del flags[index-1:index+1]
        index-=2
    else:
        index-=1
env.Replace(UPLOADERFLAGS=flags)
assert not any('boot_app0.bin' in str(flag) for flag in flags)
