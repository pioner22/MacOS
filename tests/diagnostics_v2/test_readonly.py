"""Read-only scan: real regular-file reads, mocked diskutil; no disk devices."""
import hashlib, os, re, subprocess, tempfile, unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]
ROOT=BASE/'diagnostics_v2'
PL=ROOT/'storage_readonly.pl'
XML='''<?xml version="1.0"?><plist version="1.0"><dict>
<key>DeviceIdentifier</key><string>disk2</string>
<key>DeviceNode</key><string>/dev/disk2</string>
<key>Whole</key><true/>
<key>VirtualOrPhysical</key><string>Physical</string>
<key>TotalSize</key><integer>1048576</integer>
<key>DeviceBlockSize</key><integer>512</integer>
</dict></plist>'''

def perl_code(code, *args):
    return subprocess.run(['perl','-e',f'require q{{{PL}}}; '+code,*map(str,args)],capture_output=True,text=True,timeout=10)

def shell(code):
    return subprocess.run(['/bin/bash','-c',f'. "{ROOT}/run.sh"; '+code],capture_output=True,text=True,timeout=15)

class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name);self.f=self.d/'original.img'
        self.f.write_bytes(bytes(range(256))*8192+b'abcd')
        self.before=hashlib.sha256(self.f.read_bytes()).hexdigest()
    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.f.read_bytes()).hexdigest(),self.before)
        self.t.cleanup()
    def run_scan(self, extra='', mode='full'):
        return perl_code(extra+f'exit ro_scan("image",$ARGV[0],-s $ARGV[0],1,"{mode}",5);',self.f)
    def test_full_real_read_entire_image(self):
        p=self.run_scan();self.assertEqual(p.returncode,0,p.stderr+p.stdout)
        self.assertIn('tested_bytes=2097156',p.stdout);self.assertIn('ENGINE_COMPLETE=READONLY_FULL_READ',p.stdout)
    def test_quick_small_image(self):
        p=self.run_scan(mode='quick');self.assertEqual(p.returncode,0,p.stdout)
        self.assertIn('ENGINE_COMPLETE=READONLY_SAMPLE_READ',p.stdout)
    def test_quick_samples_distant_ranges_and_last_sector(self):
        big=self.d/'big.img'
        with big.open('wb') as f:f.truncate(64*1048576)
        p=perl_code('no warnings "redefine";*ro_seek=sub{print "SEEK=$_ [1]\\n";return sysseek($_[0],$_[1],0);};exit ro_scan("image",$ARGV[0],-s $ARGV[0],512,"quick",5);'.replace('$_ [1]','$_[1]'),big)
        self.assertEqual(p.returncode,0,p.stderr+p.stdout)
        offsets=[int(x) for x in re.findall(r'SEEK=(\d+)',p.stdout)]
        self.assertEqual(len(offsets),32);self.assertEqual(offsets[0],0);self.assertEqual(offsets[-1],63*1048576)
        self.assertTrue(all(x%512==0 for x in offsets));self.assertTrue(all(b-a>=1048576 for a,b in zip(offsets,offsets[1:])))
        self.assertIn('tested_bytes=33554432',p.stdout)
    def test_short_read_completes(self):
        p=self.run_scan('no warnings "redefine"; *ro_read=sub {return sysread($_[0],$_[1],4096<$_[2]?4096:$_[2]);};')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr);self.assertIn('tested_bytes=2097156',p.stdout)
    def test_eintr_then_real_data(self):
        p=self.run_scan('no warnings "redefine";my $n=0;*ro_read=sub{if(!$n++){ $!=Errno::EINTR();return undef;}return sysread($_[0],$_[1],$_[2]);};')
        self.assertEqual(p.returncode,0,p.stdout+p.stderr)
    def test_eio_stops_on_first_error(self):
        p=self.run_scan('no warnings "redefine";*ro_read=sub{$!=Errno::EIO();return undef;};')
        self.assertEqual(p.returncode,2,p.stdout);self.assertIn('READ_IO_ERROR offset=0',p.stdout)
        self.assertIn('read_calls=1',p.stdout);self.assertNotIn('ENGINE_COMPLETE=',p.stdout)
    def test_eacces_is_not_media_fault(self):
        p=self.run_scan('no warnings "redefine";*ro_read=sub{$!=Errno::EACCES();return undef;};')
        self.assertEqual(p.returncode,3,p.stdout)
    def test_eof_not_pass(self):
        p=self.run_scan('no warnings "redefine";*ro_read=sub{return 0;};')
        self.assertEqual(p.returncode,2,p.stdout);self.assertIn('READ_UNEXPECTED_EOF',p.stdout)
    def test_seek_failure(self):
        p=self.run_scan('no warnings "redefine";*ro_seek=sub{$!=Errno::EINVAL();return undef;};')
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('READ_SEEK_ERROR',p.stdout)
    def test_interrupt_keeps_partial_count(self):
        p=self.run_scan('no warnings "redefine";*ro_read=sub{my $n=sysread($_[0],$_[1],$_[2]);kill "INT",$$;return $n;};')
        self.assertEqual(p.returncode,130,p.stdout+p.stderr);self.assertNotIn('ENGINE_COMPLETE=',p.stdout)
        self.assertIn('tested_bytes=1048576',p.stdout)
    def test_slow_read_only_observation(self):
        p=self.run_scan('no warnings "redefine";my $clock=0;*ro_clock=sub{return ++$clock;};')
        self.assertEqual(p.returncode,0,p.stdout);self.assertIn('READ_SLOW_OBSERVATION',p.stdout)
    def test_symlink_image_refused(self):
        link=self.d/'alias';link.symlink_to(self.f)
        p=subprocess.run(['perl',str(PL),'--image',str(link),'full'],capture_output=True,text=True)
        self.assertEqual(p.returncode,3)
    def test_size_disagrees_not_pass(self):
        p=perl_code('exit ro_scan("image",$ARGV[0],1024,512,"full",5);',self.f)
        self.assertEqual(p.returncode,3)
    def test_device_mode_refuses_regular_file(self):
        p=perl_code('exit ro_scan("device",$ARGV[0],1048576,512,"full",5);',self.f)
        self.assertEqual(p.returncode,3)
    def test_no_write_operations_in_reader(self):
        s=PL.read_text();self.assertNotRegex(s,r'\b(?:syswrite|truncate|unlink|O_WRONLY|O_RDWR|O_CREAT|O_TRUNC)\b')
        self.assertIn('O_RDONLY|O_NOFOLLOW',s)
    def test_image_cli(self):
        p=subprocess.run(['perl',str(PL),'--image',str(self.f),'full'],capture_output=True,text=True)
        self.assertEqual(p.returncode,0,p.stderr)
    def test_invalid_arguments_fail_closed(self):
        for mode,size,sector in [('wrong',1048576,512),('full',-1,512),('full',1048576,333),('full',0,512)]:
            with self.subTest(mode=mode,size=size,sector=sector):
                p=perl_code(f'exit ro_scan("image",$ARGV[0],{size},{sector},"{mode}",5);',self.f)
                self.assertEqual(p.returncode,3)

class MetadataTests(unittest.TestCase):
    def meta(self,xml=XML,disk='disk2'):
        return subprocess.run(['perl',str(PL),'--metadata',disk],input=xml,capture_output=True,text=True,timeout=5)
    def test_physical_contract(self):
        p=self.meta();self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stdout,'disk2\t1048576\t512\n')
    def test_partition_virtual_missing_duplicate_and_size_rejected(self):
        replacements=[('<true/>','<false/>'),('Physical','Virtual'),('<key>Whole</key><true/>',''),('</dict>','<key>TotalSize</key><integer>1048576</integer></dict>'),('<integer>512</integer>','<integer>513</integer>'),('<integer>1048576</integer>','<integer>-1</integer>'),('<integer>1048576</integer>','<integer>1048577</integer>'),('/dev/disk2','/dev/disk3')]
        for a,b in replacements:
            with self.subTest(a=a,b=b):self.assertEqual(self.meta(XML.replace(a,b)).returncode,3)
    def test_path_command_and_partition_ids_rejected(self):
        for disk in ['disk2s1','/dev/disk2','disk02','disk2;id','disk99999']:
            self.assertEqual(self.meta(disk=disk).returncode,3,disk)
    def test_large_disk_integer_preserved(self):
        p=self.meta(XML.replace('1048576','4000787030016'))
        self.assertEqual(p.returncode,0,p.stderr);self.assertIn('4000787030016',p.stdout)
    def test_malformed_or_oversize_xml_rejected(self):
        for s in ['junk',XML[:-9],XML+'bad','x'*1048577]:self.assertEqual(self.meta(s).returncode,3)

class WrapperTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.d=Path(self.t.name)
        self.xml=self.d/'disk.plist';self.xml.write_text(XML)
        self.prefix=f'''STEP_DIR="{self.d}"; KERNEL=Darwin;PROFILE_POLICY=adaptive;CAP_PERL=yes;CAP_SUPERVISOR=yes;
        profile_validate(){{ return 0; }};need(){{ return 0; }};pf_probe(){{ return 0; }};
        pf_read(){{ case "$*" in *' list')echo DISK_LIST;;*)cat "{self.xml}";;esac; }};
        N=0;read_reply(){{ N=$((N+1));case "$N" in 1)REPLY=disk2;;2)REPLY=2;;3)REPLY='READ disk2';;*)return 1;;esac; }};
        capture(){{ printf 'ENGINE_COMPLETE=READONLY_FULL_READ\\n' > "$STEP_DIR/engine.log";echo TEST_CAPTURE;return 0; }};
        '''
    def tearDown(self):self.t.cleanup()
    def test_full_wrapped_pass_scope(self):
        p=shell(self.prefix+'readonly_main');self.assertEqual(p.returncode,0,p.stdout+p.stderr)
        self.assertIn('READONLY_FULL_READ_COMPLETED',p.stdout);self.assertIn('NOT verified',p.stdout)
    def test_no_compiler_needed(self):
        p=shell(self.prefix+'CAP_NATIVE=no;readonly_main');self.assertEqual(p.returncode,0,p.stdout)
    def test_blank_consent_no_read(self):
        p=shell(self.prefix+"read_reply(){ REPLY='';return 0; };readonly_main")
        self.assertEqual(p.returncode,3);self.assertNotIn('TEST_CAPTURE',p.stdout)
    def test_wrong_disk_confirmation_no_read(self):
        p=shell(self.prefix.replace("REPLY='READ disk2'","REPLY='READ disk3'")+'readonly_main')
        self.assertEqual(p.returncode,3);self.assertNotIn('TEST_CAPTURE',p.stdout)
    def test_metadata_exit_failure_no_read(self):
        p=shell(self.prefix+f'pf_read(){{ cat "{self.xml}";return 1; }};readonly_main')
        self.assertEqual(p.returncode,3);self.assertNotIn('TEST_CAPTURE',p.stdout)
    def test_metadata_changes_after_confirmation_no_read(self):
        p=shell(self.prefix+f'''read_reply(){{ N=$((N+1));case "$N" in 1)REPLY=disk2;;2)REPLY=2;;3)REPLY='READ disk2';sed -i s/1048576/2097152/ "{self.xml}";;esac; }};readonly_main''')
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('READONLY_TARGET_CHANGED',p.stdout);self.assertNotIn('TEST_CAPTURE',p.stdout)
    def test_sample_never_full_pass(self):
        p=shell(self.prefix.replace('2)REPLY=2','2)REPLY=1').replace('ENGINE_COMPLETE=READONLY_FULL_READ','ENGINE_COMPLETE=READONLY_SAMPLE_READ')+'readonly_main')
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('READONLY_SAMPLE_CLEAN',p.stdout)
    def test_engine_failure_and_timeout(self):
        for rc,result in [(2,'READONLY_READ_ERROR_OBSERVED'),(124,'READONLY_INCOMPLETE_OR_ACCESS_DENIED')]:
            p=shell(self.prefix+f'capture(){{ return {rc}; }};readonly_main')
            self.assertEqual(p.returncode,2 if rc==2 else 3,p.stdout);self.assertIn(result,p.stdout)
    def test_missing_completion_not_pass(self):
        p=shell(self.prefix+"capture(){ : > \"$STEP_DIR/engine.log\";return 0; };readonly_main")
        self.assertEqual(p.returncode,3,p.stdout);self.assertIn('COMPLETION_MISSING',p.stdout)
    def test_unknown_profile_blocked(self):
        p=shell(self.prefix+'PROFILE_POLICY=observe;readonly_main')
        self.assertEqual(p.returncode,3);self.assertNotIn('TEST_CAPTURE',p.stdout)
    def test_report_includes_read_coverage(self):
        stage=self.d/'STORAGE_READONLY.test';stage.mkdir()
        (stage/'read-target.tsv').write_text('device\t/dev/disk2\nmode\tfull\n')
        (stage/'engine.log').write_text('READONLY_SUMMARY tested_bytes=1048576 exit_code=0\n')
        (self.d/'summary.tsv').write_text(f'STORAGE_READONLY\tPASS\tREADONLY_FULL_READ_COMPLETED\t{stage}\n')
        (self.d/'profile.txt').write_text('QA ONLY\n')
        p=shell(f'SESSION="{self.d}";MODE=readonly;report_render PASS')
        self.assertEqual(p.returncode,0,p.stderr)
        text=(self.d/'REPORT_RU_EN.md').read_text();self.assertIn('HDD/SSD READ ONLY',text);self.assertIn('tested_bytes=1048576',text)
    def test_never_added_to_automatic_acceptance(self):
        s=(ROOT/'run.sh').read_text().split('acceptance_main(){',1)[1].split('finish_suite(){',1)[0]
        self.assertNotIn('readonly_main',s)

if __name__=='__main__':unittest.main()
