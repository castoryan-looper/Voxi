from pathlib import Path
Import('env')

# All maintained firmware targets use the same Opus-only downlink protocol.
chip = env.BoardConfig().get('build.mcu')
root = Path(env['PROJECT_DIR']) / 'vendor' / 'esp_audio_opus'
if chip not in ('esp32s3', 'esp32c6'):
    raise RuntimeError('No validated Opus decoder library for ' + str(chip))
env.Append(CPPPATH=[str(root / 'include')], LIBPATH=[str(root / 'lib' / chip)],
           LIBS=['esp_audio_codec'])
