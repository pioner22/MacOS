"""Read-only HDD/SSD tests. Real small-file reads; Mac devices/metadata mocked.
Never opens a real disk. Error injection is confined to this test process.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

BASE=Path(__file__).resolve().parents[2]
ROOT=BASE/'diagnostics_v2'

def sh(code,timeout=15):
    return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/run.sh"; '+code],capture_output=True,text=True,timeout=timeout)

def metadata(**replace):
    fields={'Device Identifier':'disk7','Device Node':'/dev/disk7','Whole':'Yes',
            'Device / Media Name':'QA disk','Disk Size':'8.0 MiB (8388608 Bytes) (exactly 16384 512-Byte-Units)',
            'Device Block Size':'512 Bytes','Virtual':'No','Device Location':'External'}
    fields.update(replace)
    return ''.join(f'   {k}: {v}\n' for k,v in fields.items() if v is not None)

class ReadonlyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.d=Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def parse(self,text):
        f=self.d/'info.txt';f.write_text(text)
        return sh(f'ro_parse_info "{f}" disk7')
    def test_whole_physical_metadata(self):
        p=self.parse(metadata());self.assertEqual(p.returncode,0,p.stderr)
        self.assertEqual(p.stdout.strip(),'disk7\t8388608\t512')
    def test_metadata_unknown_or_inconsistent_fails_closed(self):
        for update in [{'Whole':'No'},{'Virtual':'Yes'},{'Virtual':None},{'Device Identifier':'disk8'},
                       {'Device Node':'/dev/disk8'},{'Device Block Size':'513 Bytes'},
                       {'Device Block Size':'0 Bytes'},{'Disk Size':'8 GB'},
                       {'Disk Size':'8 B (8388609 Bytes)'},{'Virtual or Physical':'Virtual'}]:
            with self.subTest(update=update):self.assertEqual(self.parse(metadata(**update)).returncode,3)
    def test_alternative_size_and_physical_keys(self):
        p=self.parse(metadata(**{'Disk Size':None,'Total Size':'4 MB (4194304 Bytes)',
                                 'Virtual':None,'Virtual or Physical':'Physical','Device Block Size':'4096 Bytes'}))
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout.strip(),'disk7\t4194304\t4096')
    def test_large_disk_size_no_scientific_notation(self):
        p=self.parse(metadata(**{'Disk Size':'20 TB (20000588955648 Bytes)'}))
        self.assertEqual(p.returncode,0,p.stderr);self.assertIn('20000588955648',p.stdout)
    def test_duplicate_metadata_rejected(self):
        self.assertEqual(self.parse(metadata()+'Whole: Yes\n').returncode,3)
    def test_ids_accept_only_whole_disks(self):
        for value,expected in [('disk0','disk0'),('/dev/disk7','disk7'),('/dev/rdisk7','disk7'),('rdisk20','disk20')]:
            p=sh(f'ro_device_id "{value}"');self.assertEqual(p.stdout.strip(),expected);self.assertEqual(p.returncode,0)
        for value in ['', '/dev/disk7s1','disk7;touch x','/tmp/disk7','disk-1','disk01','disk0/../null','/dev/null']:
            with self.subTest(value=value):self.assertEqual(sh(f"ro_device_id '{value}'").returncode,3)
    def engine(self, data_size=8388608, plan=None, hook='', sector=512):
        f=self.d/'input.bin';f.write_bytes(bytes(range(256))*(data_size//256));before=hashlib.sha256(f.read_bytes()).digest()
        driver='''use strict;use warnings;require $ARGV[0];open(my $fh,'<',$ARGV[1]) or die;binmode $fh;
%s
my $r=scan_handle($fh,$ARGV[2],$ARGV[3],20);close $fh;for my $k(sort keys %%$r){print "TEST_$k=$r->{$k}\\n";}exit $r->{code};
'''%hook
        p=subprocess.run(['perl','-e',driver,str(ROOT/'storage_readonly.pl'),str(f),str(plan or data_size),str(sector)],capture_output=True,text=True,timeout=30)
        self.assertEqual(hashlib.sha256(f.read_bytes()).digest(),before,'reader modified input')
        return p
    def test_real_full_read_preserves_all_bytes(self):
        p=self.engine();self.assertEqual(p.returncode,0,p.stderr+p.stdout)
        self.assertIn('TEST_read_bytes=8388608',p.stdout);self.assertIn('TEST_read_calls=2',p.stdout)
    def test_aligned_short_reads_complete(self):
        p=self.engine(hook="no warnings 'redefine';*main::ro_read=sub{return sysread($_[0],$_[1],512);};")
        self.assertEqual(p.returncode,0,p.stderr);self.assertIn('TEST_read_calls=16384',p.stdout)
    def test_eintr_retried_without_skipping(self):
        p=self.engine(hook="no warnings 'redefine';my $n=0;*main::ro_read=sub{if(!$n++){$!=Errno::EINTR();return undef;}return sysread($_[0],$_[1],$_[2]);};")
        self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('TEST_read_calls=3',p.stdout)
    def test_eio_stops_at_first_failed_block(self):
        p=self.engine(hook="no warnings 'redefine';my $n=0;*main::ro_read=sub{if($n++){$!=Errno::EIO();return undef;}return sysread($_[0],$_[1],$_[2]);};")
        self.assertEqual(p.returncode,2,p.stdout+p.stderr);self.assertIn('TEST_first_error_offset=4194304',p.stdout)
        self.assertIn('TEST_read_calls=2',p.stdout);self.assertNotIn('TEST_completed=1',p.stdout)
    def test_access_refusal_inconclusive(self):
        p=self.engine(hook="no warnings 'redefine';*main::ro_read=sub{$!=Errno::EACCES();return undef;};")
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('TEST_read_bytes=0',p.stdout)
    def test_unexpected_eof_never_passes(self):
        p=self.engine(plan=16777216);self.assertEqual(p.returncode,2,p.stdout);self.assertIn('STORAGE_RO_UNEXPECTED_EOF',p.stdout)
    def test_unaligned_short_read_never_passes(self):
        p=self.engine(hook="no warnings 'redefine';*main::ro_read=sub{return sysread($_[0],$_[1],513);};")
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('STORAGE_RO_UNALIGNED_SHORT_READ',p.stdout)
    def test_cancel_is_not_clean(self):
        p=self.engine(hook='$main::cancel=130;');self.assertEqual(p.returncode,130,p.stdout);self.assertIn('TEST_read_bytes=0',p.stdout)
    def test_invalid_geometry_no_read(self):
        p=self.engine(sector=513);self.assertEqual(p.returncode,3);self.assertIn('TEST_read_calls=0',p.stdout)
    def test_production_entry_refuses_regular_file(self):
        f=self.d/'keep';f.write_text('DATA')
        p=subprocess.run(['perl',str(ROOT/'storage_readonly.pl'),str(f),'512','512','10'],capture_output=True,text=True)
        self.assertEqual(p.returncode,3,p.stdout);self.assertEqual(f.read_text(),'DATA')
    def test_no_target_write_or_repair_implementation(self):
        text=(ROOT/'storage_readonly.pl').read_text()
        for token in ['O_WRONLY','O_RDWR','O_CREAT','O_TRUNC','syswrite(', 'truncate(']:self.assertNotIn(token,text)
        self.assertIn('sysopen($fh,$path,O_RDONLY|O_NOFOLLOW)',text)
        text=(ROOT/'storage_readonly.sh').read_text()
        for token in ['eraseDisk','repairVolume','repairDisk','unmountDisk','mountDisk','of=/dev/']:self.assertNotIn(token,text)
    def wrapper(self, consent=True, failmeta=False, changed=False, engine_rc=0, marker=True, capability=True):
        f=self.d/'info.txt';f.write_text(metadata())
        code=f'''SESSION='{self.d}';STEP_DIR='{self.d}';ROOT='{ROOT}';CAP_SUPERVISOR=yes;CAP_PERL=yes;KERNEL=Darwin;PROFILE_POLICY=adaptive;
profile_validate(){{ return 0; }}
readonly_capability(){{ echo {'perl_readonly_candidate' if capability else 'unavailable'}; }}
pf_probe(){{ return 0; }}
pf_read(){{
  shift
  case "$*" in
    'diskutil list')echo 'QA /dev/disk7 physical';;
    'diskutil info /dev/disk7')cat '{f}'; {'return 9' if failmeta else 'return 0'};;
    *)return 3;;esac
}}
replies=0;read_reply(){{ replies=$((replies+1));if [ "$replies" = 1 ];then REPLY=disk7;else REPLY={'READ\\ disk7' if consent else "''"};{'sed -i s/8388608/16777216/ '+str(f)+';' if changed else ''}fi;return 0; }}
capture(){{ echo CAPTURE_CALLED;printf '%s\\n' {'ENGINE_COMPLETE=STORAGE_READONLY_PASS' if marker else 'INCOMPLETE'} RO_SUMMARY_read_bytes=8388608 > "$STEP_DIR/engine.log";return {engine_rc}; }}
readonly_main;exit $?
'''
        return sh(code)
    def test_full_stage_contract_pass_and_explicit_scope(self):
        p=self.wrapper();self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertIn('STORAGE_RO_ALL_BYTES_READ',p.stdout);self.assertIn('were NOT tested',p.stdout)
        self.assertIn('COMPLETED',(self.d/'read-coverage.tsv').read_text())
    def test_declined_scan_never_calls_engine(self):
        p=self.wrapper(consent=False);self.assertEqual(p.returncode,3,p.stdout);self.assertNotIn('CAPTURE_CALLED',p.stdout)
    def test_failed_metadata_stdout_never_authorizes(self):
        p=self.wrapper(failmeta=True);self.assertEqual(p.returncode,3,p.stdout);self.assertNotIn('CAPTURE_CALLED',p.stdout)
    def test_changed_geometry_after_confirmation_refused(self):
        p=self.wrapper(changed=True);self.assertEqual(p.returncode,3,p.stdout);self.assertNotIn('CAPTURE_CALLED',p.stdout)
    def test_no_perl_capability_no_scan(self):
        p=self.wrapper(capability=False);self.assertEqual(p.returncode,3);self.assertNotIn('CAPTURE_CALLED',p.stdout)
    def test_missing_completion_marker_not_pass(self):
        p=self.wrapper(marker=False);self.assertEqual(p.returncode,3,p.stdout)
    def test_failed_engine_preserves_read_failure(self):
        p=self.wrapper(engine_rc=2);self.assertEqual(p.returncode,2,p.stdout);self.assertIn('STORAGE_RO_READ_PATH_ERROR',p.stdout)
    def test_menu20_routes_without_new_default_scan(self):
        p=sh("profile_show(){ :; }; read_reply(){ REPLY=20; };menu;echo MODE=$MODE")
        self.assertEqual(p.returncode,0,p.stderr);self.assertIn('MODE=readonly',p.stdout)
        text=(ROOT/'run.sh').read_text().split('acceptance_main(){',1)[1].split('menu(){',1)[0]
        self.assertNotIn('readonly_main',text)
    def test_progress_lower_bound_large_number(self):
        f=self.d/'engine.log';f.write_text('RO_PROGRESS read_bytes=1000000000000 planned_bytes=2000000000000 percent=50\n')
        self.assertEqual(sh(f'ro_read_bytes "{f}"').stdout.strip(),'1000000000000')
    def test_full_and_recovery_capability_without_compiler(self):
        for env in ['full','recovery']:
            p=sh(f'KERNEL=Darwin;ENVIRONMENT={env};PROFILE_POLICY=adaptive;CAP_PERL=yes;CAP_SUPERVISOR=yes;CAP_NATIVE=no;need(){{ [ "$1" = diskutil ]; }};readonly_capability')
            self.assertEqual(p.stdout,'perl_readonly_candidate')
    def test_unknown_profile_blocks_scan(self):
        p=sh('KERNEL=Darwin;PROFILE_POLICY=observe;CAP_PERL=yes;CAP_SUPERVISOR=yes;need(){ return 0; };readonly_capability')
        self.assertEqual(p.stdout,'unavailable')
    def test_interrupted_stage_coverage_and_report(self):
        d=self.d/'STORAGE_READONLY.qa';d.mkdir()
        (d/'read-coverage.tsv').write_text('planned_bytes\t8388608\nread_bytes\t0\nstate\tRUNNING\n')
        (d/'engine.log').write_text('RO_PROGRESS read_bytes=4194304 planned_bytes=8388608 percent=50\n')
        (self.d/'summary.tsv').write_text('');(self.d/'profile.txt').write_text('TEST PROFILE')
        p=sh(f'SESSION="{self.d}";MODE=readonly;ACTIVE_STAGE_NAME=STORAGE_READONLY;ACTIVE_STAGE_DIR="{d}";session_exit 130')
        self.assertEqual(p.returncode,130,p.stdout+p.stderr)
        self.assertIn('read_bytes\t4194304',(d/'read-coverage.tsv').read_text())
        self.assertIn('state\tINCOMPLETE',(d/'read-coverage.tsv').read_text())
        report=(self.d/'REPORT_RU_EN.md').read_text()
        self.assertIn('STORAGE_READONLY | INCONCLUSIVE | INTERRUPTED',report)
        self.assertIn('last_reported_read_bytes=4194304',report)
    def test_overlarge_size_rejected(self):
        self.assertEqual(self.parse(metadata(**{'Disk Size':'2 PB (2251799813685248 Bytes)'})).returncode,3)
    def test_timeout_is_incomplete(self):
        p=self.engine(hook="no warnings 'redefine';my $t=0;*main::ro_now=sub{$t+=30;return $t;};")
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('STORAGE_RO_TIMEOUT',p.stdout)
if __name__=='__main__':unittest.main()
