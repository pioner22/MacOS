"""Portable real process/file/crypto tests; macOS calls are explicit test doubles."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import service_common as common
from service_policy import Policy
import macos_adapter as adapter
import secure_update as update
import supervisor
import user_agent as agent
import install_service as install

class PolicyTests(unittest.TestCase):
    def test_interval_and_threshold_contract(self):
        self.assertEqual(Policy.INTERVAL, 2); self.assertEqual(Policy.FAILURES, 10)
    def test_empty_list_rejected(self):
        with self.assertRaises(ValueError): Policy([])
    def test_duplicate_list_rejected(self):
        with self.assertRaises(ValueError): Policy(['a', 'a'])
    def test_bound_list(self):
        with self.assertRaises(ValueError): Policy(list(range(265)))
    def test_nine_failures_not_enough(self):
        p=Policy(['a','b'])
        for _ in range(9): self.assertEqual(p.result(False),'retry')
        self.assertEqual(p.selected,'a'); self.assertEqual(p.failed,9)
    def test_tenth_failure_advances(self):
        p=Policy(['a','b'])
        for _ in range(10): action=p.result(False)
        self.assertEqual(action,'next'); self.assertEqual(p.selected,'b'); self.assertEqual(p.failed,0)
    def test_success_resets_failures(self):
        p=Policy(['a','b']); p.adopt('a')
        for _ in range(9): p.result(False)
        self.assertEqual(p.result(True),'connected')
        p.result(False); self.assertEqual(p.failed,1); self.assertEqual(p.selected,'a')
    def test_cyclic_not_exhausted(self):
        p=Policy(['a','b','c'])
        for sweep in range(100):
            for name in 'abc':
                self.assertEqual(p.selected,name)
                for _ in range(10): p.result(False)
        self.assertEqual(p.selected,'a'); self.assertFalse(p.stopped)
    def test_single_node_retry(self):
        p=Policy(['a'])
        for _ in range(10): p.result(False)
        self.assertEqual(p.selected,'a'); self.assertIsNotNone(p.incident)
    def test_one_incident_per_outage(self):
        p=Policy(['a','b'])
        for _ in range(10): p.result(False)
        self.assertIsNone(p.incident)
        for _ in range(10): p.result(False)
        incident=p.incident; self.assertIsNotNone(incident)
        for _ in range(100): p.result(False)
        self.assertEqual(p.incident,incident)
    def test_three_active_successes_clear_incident(self):
        p=Policy(['a'])
        for _ in range(10): p.result(False)
        p.applied(True)
        p.result(True); self.assertIsNotNone(p.incident)
        p.result(True); self.assertIsNone(p.incident)
    def test_candidate_success_not_connected(self):
        p=Policy(['a']); self.assertEqual(p.result(True),'activate')
        self.assertEqual(p.phase,'candidate')
    def test_activation_must_be_verified(self):
        p=Policy(['a','b']); p.applied(False)
        self.assertEqual(p.phase,'candidate'); self.assertEqual(p.selected,'b')
    def test_no_return_to_primary_when_healthy(self):
        p=Policy(['a','b']); p.adopt('b')
        for _ in range(100): p.result(True)
        self.assertEqual(p.selected,'b')
    def test_offline_does_not_exhaust_profiles(self):
        p=Policy(['a','b']); p.result(False)
        for _ in range(100): p.network_wait()
        self.assertEqual(p.selected,'a'); self.assertEqual(p.failed,0)
    def test_stop_is_terminal_for_this_generation(self):
        p=Policy(['a','b']); p.stop()
        for _ in range(100):
            self.assertEqual(p.result(True),'none'); self.assertEqual(p.result(False),'none'); p.advance(); p.applied(True)
        self.assertFalse(p.ready(100000)); self.assertEqual(p.phase,'stopped'); self.assertEqual(p.selected,'a')
    def test_interval_from_start(self):
        p=Policy(['a']); p.schedule(10,10.1)
        self.assertFalse(p.ready(11.99)); self.assertTrue(p.ready(12))
    def test_no_catchup_burst_after_delay(self):
        p=Policy(['a']); p.schedule(10,200)
        self.assertEqual(p.due,200)
        p.schedule(200,200.01); self.assertEqual(p.due,202)

class EngineTests(unittest.TestCase):
    def test_no_activation_after_cancelled_probe(self):
        a=Mock(); a.probe.side_effect=common.Cancelled()
        with self.assertRaises(common.Cancelled): supervisor.one_round(Policy(['a']),a,{},0)
        a.activate.assert_not_called()
    def test_activation_before_connected(self):
        a=Mock(); a.probe.return_value=True; a.activate.return_value=True
        p=Policy(['a'])
        self.assertEqual(supervisor.one_round(p,a,{},0),'connected')
        a.activate.assert_called_once(); self.assertEqual(p.phase,'active')
    def test_failure_cleanup_precedes_next(self):
        a=Mock(); a.probe.return_value=True; a.activate.side_effect=RuntimeError('fixture')
        p=Policy(['a','b']); self.assertEqual(supervisor.one_round(p,a,{},0),'next')
        a.disconnect.assert_called_once(); self.assertEqual(p.selected,'b')
    def test_cleanup_failure_not_ignored(self):
        a=Mock(); a.probe.return_value=True; a.activate.side_effect=RuntimeError(); a.disconnect.side_effect=common.ServiceError()
        with self.assertRaises(common.ServiceError): supervisor.one_round(Policy(['a','b']),a,{},0)
    def test_no_network_call_after_stop(self):
        p=Policy(['a']); p.stop(); a=Mock()
        self.assertEqual(supervisor.one_round(p,a,{},0),'stopped'); a.probe.assert_not_called()
    def test_cancel_during_activation_not_counted_as_endpoint_failure(self):
        p=Policy(['a','b']); a=Mock(); a.probe.return_value=True; a.activate.side_effect=common.Cancelled()
        with self.assertRaises(common.Cancelled): supervisor.one_round(p,a,{},0)
        self.assertEqual(p.selected,'a')

class FileProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup); self.root=Path(self.temp.name)
    def test_atomic_file_private(self):
        p=self.root/'state'; common.atomic(str(p),b'old'); common.atomic(str(p),b'new')
        self.assertEqual(common.read_checked(str(p),private=True),b'new'); self.assertEqual(p.stat().st_mode&0o777,0o600)
    def test_symlink_rejected_on_read_and_write(self):
        p=self.root/'file'; p.write_bytes(b'secret'); q=self.root/'link'; q.symlink_to(p)
        with self.assertRaises((OSError,common.ServiceError)): common.read_checked(str(q))
        with self.assertRaises((OSError,common.ServiceError)): common.atomic(str(q),b'bad')
        self.assertEqual(p.read_bytes(),b'secret')
    def test_hardlink_rejected(self):
        p=self.root/'file'; p.write_bytes(b'x'); os.link(p,self.root/'other')
        with self.assertRaises(common.ServiceError): common.read_checked(str(p))
    def test_public_writable_file_rejected(self):
        p=self.root/'file'; p.write_bytes(b'x'); p.chmod(0o666)
        with self.assertRaises(common.ServiceError): common.read_checked(str(p))
    def test_oversize_rejected(self):
        p=self.root/'file'; p.write_bytes(b'x'*100)
        with self.assertRaises(common.ServiceError): common.read_checked(str(p),99)
    def test_fifo_rejected_without_hang(self):
        p=self.root/'fifo'; os.mkfifo(p)
        with self.assertRaises(common.ServiceError): common.read_checked(str(p))
    def test_real_nonblocking_lock(self):
        p=str(self.root/'lock')
        with common.locked(p):
            with self.assertRaises(common.Busy):
                with common.locked(p): pass
    def test_journal_rotation_is_bounded(self):
        with patch.object(common,'PRIVATE',str(self.root)):
            for n in range(100): common.journal({'phase':'searching','count':n},maximum=100)
        self.assertEqual(len(list(self.root.glob('supervisor-events.jsonl*'))),3)
        for p in self.root.glob('supervisor-events.jsonl*'):
            self.assertLess(p.stat().st_size,180); self.assertEqual(p.stat().st_mode&0o777,0o600)
    def test_fault_pause_survives_restart_and_explicit_resume_clears_it(self):
        path=str(self.root/'control')
        common.write_json(path,dict(enabled=True,paused=False,auto_update=True,generation='a'*32))
        with patch.object(common,'CONTROL',path),patch.object(common,'PRIVATE',str(self.root)):
            common.change_intent(paused=True,fault='adapter_failed')
            self.assertEqual(common.control()['fault'],'adapter_failed')
            self.assertTrue(common.control()['paused'])
            common.change_intent(paused=False)
            self.assertIsNone(common.control()['fault'])
    def test_real_process_output(self):
        rc,out,err=common.run([sys.executable,'-c','print("ok")'])
        self.assertEqual((rc,out,err),(0,b'ok\n',b''))
    def test_real_timeout(self):
        started=time.monotonic(); rc,_,_=common.run([sys.executable,'-c','import time; time.sleep(30)'],timeout=.15)
        self.assertEqual(rc,124); self.assertLess(time.monotonic()-started,3)
    def test_real_cancellation_kills_child(self):
        ticks=[0]
        def check():
            ticks[0]+=1
            if ticks[0]>3: raise common.Cancelled()
        with self.assertRaises(common.Cancelled): common.run([sys.executable,'-c','import time; time.sleep(30)'],check=check)
    def test_output_is_bounded(self):
        rc,out,err=common.run([sys.executable,'-c','import os; os.write(1,b"x"*100000)'],file_limit=1024)
        self.assertLessEqual(len(out),1024); self.assertLessEqual(len(err),1024)
    def test_persistent_stop_invalidates_old_generation(self):
        path=str(self.root/'control')
        common.write_json(path,dict(enabled=True,paused=False,auto_update=True,generation='a'*32))
        with patch.object(common,'CONTROL',path), patch.object(common,'PRIVATE',str(self.root)):
            common.cancel_check('a'*32)
            value=common.change_intent(enabled=False)
            self.assertFalse(value['enabled']); self.assertTrue(value['auto_update'])
            with self.assertRaises(common.Cancelled): common.cancel_check('a'*32)
            with self.assertRaises(common.Cancelled): common.cancel_check(value['generation'])

class CandidateTests(unittest.TestCase):
    def node(self,host='144.31.180.114',kind='socks',ident='a'*20):
        return {'id':ident,'name':'fixture','outbound':{'type':kind,'server':host,'server_port':45004,'username':'fixture','password':'NOT-A-REAL-PASSWORD'}}
    def test_second_ip_uses_authorized_credentials(self):
        rt=Mock(); state={'socks5':self.node()}; before=copy.deepcopy(state)
        result=adapter.nodes_from_catalog(rt,state)
        self.assertEqual([n['outbound']['server'] for n in result],['144.31.180.114','87.251.86.229'])
        self.assertEqual(result[1]['outbound']['password'],'NOT-A-REAL-PASSWORD'); self.assertEqual(state,before)
    def test_does_not_copy_unrelated_credentials(self):
        result=adapter.nodes_from_catalog(Mock(),{'socks5':self.node('192.0.2.1')})
        self.assertEqual(len(result),1)
    def test_protocols_and_ips_all_present(self):
        state={'socks5':self.node(), 'nodes':[self.node('192.0.2.3','vless','b'*20)],'bootstrap':[self.node('192.0.2.4','trojan','c'*20)]}
        result=adapter.nodes_from_catalog(Mock(),state)
        self.assertEqual([n['outbound']['type'] for n in result],['socks','socks','vless','trojan'])
    def test_explicit_disabled_profile_excluded(self):
        disabled=self.node('192.0.2.3','vless','b'*20); disabled['enabled']=False
        result=adapter.nodes_from_catalog(Mock(),{'socks5':self.node('192.0.2.1'),'nodes':[disabled]})
        self.assertEqual(len(result),1)
    def test_unsupported_protocol_not_claimed(self):
        with self.assertRaises(common.ServiceError): adapter.nodes_from_catalog(Mock(),{'nodes':[self.node(kind='amnezia')]})
    def test_duplicate_profile_removed(self):
        n=self.node('192.0.2.1','vless'); result=adapter.nodes_from_catalog(Mock(),{'nodes':[n,n]})
        self.assertEqual(len(result),1)
    def test_probe_never_defaults_to_direct(self):
        with self.assertRaises(common.ServiceError): adapter.probe_round()
        with self.assertRaises(common.ServiceError): adapter.probe_round(interface='utun98',auth='a'*48)
    def test_probe_transport_flags_and_success_contract(self):
        launched=[]
        def launch(args,**kwargs):
            launched.append((args,kwargs['stdin'].read()))
            kwargs['stdout'].write(b'204 0'); kwargs['stdout'].flush()
            p=Mock(); p.poll.return_value=0; p.returncode=0; return p
        with patch.object(adapter.subprocess,'Popen',side_effect=launch):
            self.assertTrue(adapter.probe_round(interface='utun98'))
        self.assertEqual(len(launched),2)
        for args,cfg in launched:
            self.assertIn('--interface',args); self.assertIn('utun98',args); self.assertNotIn('-k',args)
    def test_proxy_auth_not_in_argv(self):
        launched=[]
        def launch(args,**kwargs):
            launched.append((args,kwargs['stdin'].read())); kwargs['stdout'].write(b'204 0'); kwargs['stdout'].flush()
            p=Mock(); p.poll.return_value=0; p.returncode=0; return p
        secret='b'*48
        with patch.object(adapter.subprocess,'Popen',side_effect=launch): self.assertTrue(adapter.probe_round(auth=secret))
        for args,cfg in launched:
            self.assertNotIn(secret,' '.join(args)); self.assertIn(secret.encode(),cfg); self.assertIn(b'socks5h://127.0.0.1:17891',cfg)
    def test_wrong_http_status_not_success(self):
        def launch(args,**kwargs):
            kwargs['stdout'].write(b'200 0'); kwargs['stdout'].flush(); p=Mock(); p.poll.return_value=0; p.returncode=0; return p
        with patch.object(adapter.subprocess,'Popen',side_effect=launch): self.assertFalse(adapter.probe_round(interface='utun98'))

class AdapterBoundaryTests(unittest.TestCase):
    def test_unprepared_candidate_cannot_be_activated(self):
        obj=adapter.MacAdapter.__new__(adapter.MacAdapter)
        obj.check=Mock(); obj.prepared=None; obj.prepared_node=None; obj.close_probe=Mock()
        with self.assertRaises(common.ServiceError): obj.activate({'id':'a'*20})
        obj.close_probe.assert_not_called()
    def test_dns_failure_is_endpoint_failure_not_silent_direct_fallback(self):
        obj=adapter.MacAdapter.__new__(adapter.MacAdapter)
        obj.check=Mock(); obj.prepare=Mock(side_effect=adapter.ProbeUnavailable('fixture'))
        with patch.object(adapter,'probe_round') as probe:
            self.assertFalse(obj.probe({'id':'a'*20},False))
            probe.assert_not_called()
    def test_candidate_resolved_before_config_and_saved_for_activation(self):
        obj=adapter.MacAdapter.__new__(adapter.MacAdapter)
        obj.check=Mock(); obj.disconnect=Mock(); obj.runtime=Mock(); obj.prepared=None
        obj.runtime.assert_no_other_vpn=Mock()
        obj.probe_path='/not-written-by-test'; obj.probe_auth='a'*48
        node={'id':'a'*20,'outbound':{'server':'vpn.example'}}
        resolved={'id':'a'*20,'outbound':{'server':'192.0.2.10'}}
        obj.runtime.resolve_node.return_value=resolved
        obj.runtime.make_config.return_value={'inbounds':[{}]}
        with patch.object(adapter.subprocess,'Popen',return_value=Mock()): obj.prepare(node)
        obj.runtime.make_config.assert_called_once_with(resolved,obj.probe_auth,False)
        self.assertEqual(obj.prepared_node,resolved)

class ManifestTests(unittest.TestCase):
    def manifest(self):
        return dict(schema=1,channel='stable',build=2,version='2.2.0',architecture='x86_64',minimum_os='11.0',maximum_os_major=11,
                    issued_at=1000,expires_at=2000,package_id=update.PKG_ID,
                    url='https://github.com/pioner22/MacOS/releases/download/vpn-service-v2.2.0/BigSurVPN-2.2.0.pkg',sha256='a'*64,size=100)
    def parse(self,m=None,build=1,now=1500): return update.parse_manifest(json.dumps(m or self.manifest()).encode(),now,build)
    def test_valid_manifest(self): self.assertEqual(self.parse()['build'],2)
    def test_same_build_permitted_for_current_check(self): self.parse(build=2)
    def test_downgrade_rejected(self):
        with self.assertRaises(common.ServiceError): self.parse(build=3)
    def test_expiry_rejected(self):
        with self.assertRaises(common.ServiceError): self.parse(now=2000)
    def test_future_metadata_rejected(self):
        with self.assertRaises(common.ServiceError): self.parse(now=699)
    def test_channel_arch_platform_identity_enforced(self):
        for key,value in [('channel','beta'),('architecture','arm64'),('minimum_os','12.0'),('maximum_os_major',12),('package_id','org.other')]:
            with self.subTest(key=key):
                m=self.manifest(); m[key]=value
                with self.assertRaises(common.ServiceError): self.parse(m)
    def test_no_boolean_numeric_values(self):
        for key in ('schema','build','size','issued_at','expires_at','maximum_os_major'):
            with self.subTest(key=key):
                m=self.manifest(); m[key]=True
                with self.assertRaises(common.ServiceError): self.parse(m)
    def test_invalid_size_hash_version(self):
        for key,value in [('size',0),('size',update.PACKAGE_LIMIT+1),('sha256','a'*63),('version','2.2.0-rc1')]:
            m=self.manifest(); m[key]=value
            with self.assertRaises(common.ServiceError): self.parse(m)
    def test_arbitrary_download_sources_rejected(self):
        for url in ('http://github.com/pioner22/MacOS/releases/download/x/a.pkg','https://evil.example/x.pkg',
                    'https://github.com.evil.example/pioner22/MacOS/releases/download/x/a.pkg',
                    'https://github.com/pioner22/MacOS/blob/main/install.sh',
                    self.manifest()['url']+'?other=1'):
            m=self.manifest(); m['url']=url
            with self.assertRaises(common.ServiceError): self.parse(m)
    def test_duplicate_json_keys_rejected(self):
        with self.assertRaises(common.ServiceError): update.strict_json(b'{"build":1,"build":2}')
    def test_oversize_manifest(self):
        with self.assertRaises(common.ServiceError): update.parse_manifest(b' '*65537,1500,1)
    def test_unconfigured_updater_does_not_download_or_install(self):
        with patch.object(update,'require_host'), patch.object(update,'control',return_value={'auto_update':True}), \
             patch.object(update.os.path,'exists',return_value=False), patch.object(update,'status') as status, patch.object(update,'download') as download:
            self.assertEqual(update.once(),0); status.assert_called_once_with('NOT_CONFIGURED'); download.assert_not_called()
    def test_disabled_update_does_not_download(self):
        with patch.object(update,'require_host'), patch.object(update,'control',return_value={'auto_update':False}), \
             patch.object(update,'status') as status, patch.object(update,'download') as download:
            self.assertEqual(update.once(),0); status.assert_called_once_with('DISABLED'); download.assert_not_called()

class RealSignatureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.root=Path(cls.temp.name)
        cls.private=cls.root/'private.pem'; cls.public=cls.root/'public.pem'; cls.message=cls.root/'manifest'; cls.signature=cls.root/'signature'
        subprocess.run(['/usr/bin/openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out',str(cls.private)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        subprocess.run(['/usr/bin/openssl','pkey','-in',str(cls.private),'-pubout','-out',str(cls.public)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        cls.message.write_bytes(b'actual cryptographic fixture, not a fake verifier'); cls.message.chmod(0o600)
        subprocess.run(['/usr/bin/openssl','dgst','-sha256','-sign',str(cls.private),'-out',str(cls.signature),str(cls.message)],check=True)
        cls.signature.chmod(0o600); cls.original=cls.message.read_bytes()
    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()
    def test_real_valid_signature(self): update.verify_signature(str(self.message),str(self.signature),str(self.public))
    def test_modified_signed_bytes_rejected(self):
        bad=self.root/'bad'; bad.write_bytes(self.original+b'!'); bad.chmod(0o600)
        with self.assertRaises(common.ServiceError): update.verify_signature(str(bad),str(self.signature),str(self.public))
    def test_modified_signature_rejected(self):
        bad=self.root/'bad.sig'; data=bytearray(self.signature.read_bytes()); data[0]^=1; bad.write_bytes(data); bad.chmod(0o600)
        with self.assertRaises(common.ServiceError): update.verify_signature(str(self.message),str(bad),str(self.public))
    def test_private_key_rejected_as_anchor(self):
        with self.assertRaises(common.ServiceError): update.verify_signature(str(self.message),str(self.signature),str(self.private))
    def test_package_hash_checked_before_apple_tools(self):
        path=self.root/'fixture.pkg'; path.write_bytes(b'fixture'); path.chmod(0o600); executor=Mock(return_value=(0,b'1. Developer ID Installer: Fixture (ABCDEFGHIJ)\n',b''))
        with self.assertRaises(common.ServiceError): update.verify_package(str(path),{'size':7,'sha256':'a'*64},'ABCDEFGHIJ',executor)
        executor.assert_not_called()
    def test_wrong_apple_team_rejected(self):
        path=self.root/'fixture.pkg'; path.write_bytes(b'fixture'); path.chmod(0o600)
        manifest={'size':7,'sha256':hashlib.sha256(b'fixture').hexdigest()}
        executor=Mock(return_value=(0,b'1. Developer ID Installer: Fixture (KLMNOPQRST)',b''))
        with self.assertRaises(common.ServiceError): update.verify_package(str(path),manifest,'ABCDEFGHIJ',executor)
        self.assertEqual(executor.call_count,1)
    def test_gatekeeper_rejection_blocks_package(self):
        path=self.root/'fixture.pkg'; path.write_bytes(b'fixture'); path.chmod(0o600)
        manifest={'size':7,'sha256':hashlib.sha256(b'fixture').hexdigest()}
        executor=Mock(side_effect=[(0,b'  1. Developer ID Installer: Fixture (ABCDEFGHIJ)\n',b''),(1,b'',b'rejected')])
        with self.assertRaises(common.ServiceError): update.verify_package(str(path),manifest,'ABCDEFGHIJ',executor)
        self.assertEqual(executor.call_count,2)

class AgentLaunchTests(unittest.TestCase):
    def state(self): return {'phase':'searching','incident':'a'*32,'checked_at':100}
    def test_alert_once_per_incident(self):
        self.assertTrue(agent.should_warn(self.state(),None,101)); self.assertFalse(agent.should_warn(self.state(),'a'*32,101))
    def test_no_stale_alert(self): self.assertFalse(agent.should_warn(self.state(),None,116))
    def test_no_alert_connected_or_stopped(self):
        for phase in ('connected','stopped','paused'):
            v=self.state(); v['phase']=phase; self.assertFalse(agent.should_warn(v,None,101))
    def test_local_errors_visible(self):
        v=self.state(); v['phase']='local_error'; self.assertTrue(agent.should_warn(v,None,101))
    def test_notifier_not_privileged(self):
        with patch.object(agent.sys,'platform','darwin'),patch.object(agent.os,'geteuid',return_value=0): self.assertEqual(agent.main(),1)
    def test_launchd_jobs_roles_and_intervals(self):
        jobs=install.jobs(); self.assertEqual(len(jobs),3)
        monitor,updater,ui=[x[1] for x in jobs]
        self.assertTrue(monitor['KeepAlive']); self.assertEqual(updater['StartInterval'],21600)
        self.assertEqual(ui['LimitLoadToSessionType'],'Aqua'); self.assertNotIn('UserName',ui)
        self.assertTrue(jobs[0][0].startswith('/Library/LaunchDaemons/')); self.assertTrue(jobs[2][0].startswith('/Library/LaunchAgents/'))
        for _,job in jobs: self.assertEqual(plistlib.loads(install.plist(job)),job)
    def test_preview_install_requires_explicit_flag(self):
        with patch.object(sys,'argv',['install_service.py']),patch.object(install,'install') as act:
            with self.assertRaises(common.ServiceError): install.main()
            act.assert_not_called()
    def test_wrapper_syntax_and_stop_alias(self):
        with tempfile.NamedTemporaryFile() as tmp:
            tmp.write(install.WRAPPER.encode()); tmp.flush(); subprocess.run(['/bin/bash','-n',tmp.name],check=True)
        self.assertIn('cmd=${cmd#--}',install.WRAPPER); self.assertIn('"$S/supervisor.py" "$cmd"',install.WRAPPER)

if __name__=='__main__': unittest.main()
