from base64 import b64encode
from pathlib import Path
Import('env')
project=Path(env['PROJECT_DIR'])
gateway=project.parent/'gateway'
html=(gateway/'setup.html').read_text(encoding='utf-8')
theme_link='<link rel="stylesheet" href="/shared/theme.css">'
if html.count(theme_link)!=1:
    raise ValueError('Setup page must link to the shared theme once')
theme=(gateway/'theme.css').read_text(encoding='utf-8')
art_url='/shared/radio-schematic.svg'
if art_url not in theme:
    raise ValueError('Shared theme must reference the radio schematic')
art=b64encode((gateway/'radio-schematic.svg').read_bytes()).decode('ascii')
theme=theme.replace(art_url, 'data:image/svg+xml;base64,'+art)
html=html.replace(theme_link, '<style>\n'+theme+'</style>', 1)
target=project/'include/setup_page.h'
content='#pragma once\n#include <Arduino.h>\nstatic const char SETUP_PAGE[] PROGMEM=R"VOXI_PAGE('+html+')VOXI_PAGE";\n'
if not target.exists() or target.read_text(encoding='utf-8')!=content:
    target.write_text(content,encoding='utf-8')
