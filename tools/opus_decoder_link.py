from pathlib import Path
Import('env')

# Link only the S3 MiniCam targets; other boards retain their existing codecs.
if env['PIOENV'].startswith('zhengchen_minicam_20'):
    root = Path(env['PROJECT_DIR']) / 'vendor' / 'esp_audio_opus'
    env.Append(CPPPATH=[str(root / 'include')], LIBPATH=[str(root / 'lib')],
               LIBS=['esp_audio_codec'])
