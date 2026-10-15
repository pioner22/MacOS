"""Real CLI on this host. No network requests, system mutations or provider keys."""
import json, os, pathlib, subprocess, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[1]
CLI = ROOT / 'macdiag'
class CLIContract(unittest.TestCase):
    def call(self,*args,cwd=None,env=None):
        return subprocess.run(['/bin/bash',str(CLI),*args],capture_output=True,text=True,timeout=30,cwd=cwd,env=env)
    def test_options_not_silently_ignored(self):
        for args in [('version','extra'),('profile','collect','--test','network.ip'),('plan','--workflow','basic','--test','network.ip')]:
            self.assertNotEqual(self.call(*args).returncode,0,args)
    def test_version(self):
        r=self.call('version');self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout.strip(),'0.1.0')
    def test_offline_profile(self):
        r=self.call('profile','collect','--format','json');self.assertEqual(r.returncode,0,r.stderr)
        p=json.loads(r.stdout);self.assertEqual(p['schema'],'macdiag.profile.v1');self.assertEqual(p['privacy']['network_requests'],'NONE')
    def test_relative_output_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            r=self.call('profile','collect','--output','local.json',cwd=d);self.assertEqual(r.returncode,0,r.stderr)
            p=pathlib.Path(d)/'local.json';self.assertEqual(p.stat().st_mode&0o777,0o600)
            before=p.read_bytes();r=self.call('profile','collect','--output','local.json',cwd=d)
            self.assertNotEqual(r.returncode,0);self.assertEqual(p.read_bytes(),before)
    def test_saved_snapshot_never_runs(self):
        r=self.call('run','--test','network.ip','--snapshot','fake.json');self.assertNotEqual(r.returncode,0);self.assertIn('SNAPSHOT_CANNOT_AUTHORIZE',r.stderr)
    def test_no_force(self):
        self.assertNotEqual(self.call('run','--test','system.inventory','--force').returncode,0)
    def test_no_fake_profile(self):
        r=self.call('profile','collect','--profile','big-sur-intel-bash32');self.assertNotEqual(r.returncode,0)
    def test_implemented_safe_test(self):
        r=self.call('run','--test','system.inventory','--format','json');self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(json.loads(r.stdout)['checks'][0]['scope'],'METADATA_NOT_HEALTH')
    def test_mutation_blocked(self):
        r=self.call('run','--test','vpn.install','--format','json');self.assertEqual(r.returncode,2,r.stderr)
        self.assertEqual(json.loads(r.stdout)['checks'][0]['reason'],'NOT_IMPLEMENTED')
    def test_network_default_blocked(self):
        r=self.call('run','--test','network.ip','--format','json');self.assertEqual(r.returncode,2,r.stderr)
        self.assertEqual(json.loads(r.stdout)['checks'][0]['reason'],'POLICY_OBSERVE')
    def test_data_not_shell(self):
        r=self.call('run','--test','$(touch BAD)');self.assertNotEqual(r.returncode,0)
    def test_snapshot_plan_and_diff(self):
        with tempfile.TemporaryDirectory() as d:
            r=self.call('profile','collect','--output','a.json',cwd=d);self.assertEqual(r.returncode,0,r.stderr)
            p=pathlib.Path(d)/'a.json';s=json.loads(p.read_text());s['facts']['os_build']='different'
            (pathlib.Path(d)/'b.json').write_text(json.dumps(s))
            r=self.call('plan','--workflow','basic','--snapshot','a.json','--format','json',cwd=d);self.assertEqual(r.returncode,0,r.stderr)
            self.assertEqual(json.loads(r.stdout)['source'],'SAVED_SNAPSHOT_UNTRUSTED')
            r=self.call('profile','diff','--before','a.json','--after','b.json','--format','json',cwd=d);self.assertEqual(r.returncode,0,r.stderr)
            self.assertTrue(json.loads(r.stdout)['reprobe_required'])
    def test_polluted_perl_environment_is_cleared(self):
        env=dict(os.environ,PERL5OPT='-MNotInstalledMalicious',PERL5LIB='/no/such/lib')
        r=self.call('version',env=env);self.assertEqual(r.returncode,0,r.stderr)
    def test_untrusted_working_dir_not_imported(self):
        with tempfile.TemporaryDirectory() as d:
            (pathlib.Path(d)/'JSON.pm').write_text('die "HOSTILE_MODULE";')
            r=self.call('version',cwd=d);self.assertEqual(r.returncode,0,r.stderr);self.assertNotIn('HOSTILE',r.stderr)
if __name__=='__main__': unittest.main(verbosity=2)
