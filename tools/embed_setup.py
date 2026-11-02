from pathlib import Path
Import('env')
project=Path(env['PROJECT_DIR'])
html=(project.parent/'gateway/setup.html').read_text(encoding='utf-8')
target=project/'include/setup_page.h'
content='#pragma once\n#include <Arduino.h>\nstatic const char SETUP_PAGE[] PROGMEM=R"VOXI_PAGE('+html+')VOXI_PAGE";\n'
if not target.exists() or target.read_text(encoding='utf-8')!=content:
    target.write_text(content,encoding='utf-8')
