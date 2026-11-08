#!/usr/bin/env python3
"""Upgrade Pocket via its existing deployment owner, preserving data volumes.

Compose working_dir may be an immutable archive, not a Git checkout. Prefer
the configured snapshot deployer; only use docker.sh for a real checkout.
"""
import json
import os
from pathlib import Path
import subprocess
import sys

CONFIG = Path('/etc/codex-pocket-autodeploy.json')
DEPLOYER = Path('/usr/local/lib/codex-pocket-autodeploy/autodeploy.py')


def run(args, *, capture=False, cwd=None):
    result = subprocess.run(args, cwd=cwd, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            env=dict(os.environ, GIT_TERMINAL_PROMPT='0', GIT_SSH_COMMAND='ssh -o BatchMode=yes'))
    return result.stdout.strip() if capture else ''


def upgrade(config=CONFIG, deployer=DEPLOYER, command=run):
    config, deployer = Path(config), Path(deployer)
    if config.exists():
        settings = json.loads(config.read_text())
        if not isinstance(settings,dict) or not isinstance(settings.get('repo'),str):
            raise ValueError('Automatic deployment configuration has no source repository; configuration was not changed.')
        repo = Path(settings.get('repo', ''))
        if not repo.is_absolute() or not (repo/'compose.yaml').is_file():
            raise ValueError('Automatic deployment configuration has no valid source repository; configuration was not changed.')
        if not deployer.is_file():
            raise ValueError('Automatic deployment is configured, but its installed updater is missing. Refusing to replace it with a manual deployment.')
        print('Using the existing Pocket snapshot deployer. No git checkout is needed in the running release.', flush=True)
        command(['python3', str(deployer), 'run', '--config', str(config), '--retry'])
        print('Updater returned. If it reported another deployment running, wait for that run; verify with deploy/check-agent.sh.', flush=True)
        return

    directory = command(['docker', 'inspect', 'codex-pocket-gateway-1', '--format',
                         '{{index .Config.Labels "com.docker.compose.project.working_dir"}}'], capture=True)
    repo = Path(directory)
    if not directory or not repo.is_absolute() or not repo.is_dir():
        raise ValueError('The Pocket container has no valid Compose working directory. No deployment was attempted.')
    # Resolve the exact checkout root; an archive inside some other repository
    # must not accidentally update that parent repository.
    root = command(['git', '-c', 'safe.directory='+str(repo), '-C', str(repo), 'rev-parse', '--show-toplevel'], capture=True)
    if Path(root).resolve() != repo.resolve():
        raise ValueError('Compose directory is not the Git checkout root. No repository was changed.')
    for file in ('.env.docker', 'deploy/docker.sh', 'bridge/voxi.py'):
        if not (repo/file).is_file():
            raise ValueError('Not a configured Pocket checkout: missing '+file)
    prefix = ['git', '-c', 'safe.directory='+str(repo), '-C', str(repo)]
    command([*prefix, 'diff', '--quiet'])
    command([*prefix, 'diff', '--cached', '--quiet'])
    command([*prefix, 'fetch', 'origin'])
    command([*prefix, 'merge', '--ff-only', 'origin/main'])
    command(['bash', str(repo/'deploy/docker.sh'), 'up'], cwd=str(repo))
    print('Pocket Docker upgrade completed. Verify with deploy/check-agent.sh.', flush=True)


def main():
    if sys.platform != 'linux' or os.geteuid() != 0:
        print('Run on the server: sudo python3 deploy/upgrade-pocket-agent.py', file=sys.stderr)
        return 1
    try:
        upgrade()
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print('Pocket upgrade stopped: '+str(error), file=sys.stderr)
        print('Existing configuration and volumes were not deleted. Inspect the message above before retrying.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
