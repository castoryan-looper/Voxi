import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE=Path(__file__).resolve().parents[1]/'deploy/upgrade-pocket-agent.py'
spec=importlib.util.spec_from_file_location('upgrade_pocket',SOURCE)
upgrade=importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)


class UpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.repo=self.root/'repo';self.repo.mkdir()
        (self.repo/'compose.yaml').touch()
        self.config=self.root/'autodeploy.json';self.deployer=self.root/'updater.py';self.deployer.touch()
        self.calls=[]
    def command(self,args,**kwargs):
        self.calls.append((args,kwargs))
        if args[0]=='docker':return str(self.repo)
        if 'rev-parse' in args:return str(self.repo)
        return ''
    def test_snapshot_deployer_never_runs_git_in_archive(self):
        self.config.write_text(json.dumps({'repo':str(self.repo)}))
        upgrade.upgrade(self.config,self.deployer,self.command)
        self.assertEqual(self.calls,[(['python3',str(self.deployer),'run','--config',str(self.config),'--retry'],{})])
        self.assertFalse((self.repo/'.git').exists())
    def test_missing_managed_updater_does_not_fall_back_to_manual_rebuild(self):
        self.config.write_text(json.dumps({'repo':str(self.repo)}));self.deployer.unlink()
        with self.assertRaises(ValueError):upgrade.upgrade(self.config,self.deployer,self.command)
        self.assertEqual(self.calls,[])
    def test_real_checkout_uses_fast_forward_and_existing_docker_config(self):
        for name in ('.env.docker','deploy/docker.sh','bridge/voxi.py'):
            p=self.repo/name;p.parent.mkdir(exist_ok=True);p.touch()
        upgrade.upgrade(self.config,self.deployer,self.command)
        self.assertTrue(any('merge' in args and '--ff-only' in args for args,_ in self.calls))
        self.assertEqual(self.calls[-1],(['bash',str(self.repo/'deploy/docker.sh'),'up'],{'cwd':str(self.repo)}))
    def test_archive_cannot_accidentally_update_parent_repository(self):
        def command(args,**kwargs):
            if args[0]=='docker':return str(self.repo)
            return str(self.root)
        with self.assertRaises(ValueError):upgrade.upgrade(self.config,self.deployer,command)
    def test_failed_checkout_check_never_fetches_or_rebuilds(self):
        def command(args,**kwargs):
            self.calls.append(args)
            if args[0]=='docker':return str(self.repo)
            raise subprocess.CalledProcessError(128,args)
        with self.assertRaises(subprocess.CalledProcessError):upgrade.upgrade(self.config,self.deployer,command)
        self.assertFalse(any('fetch' in args or 'up' in args for args in self.calls))


if __name__=='__main__':unittest.main()
