"""Regression: a real Ctrl+C on a PTY must record the interrupted stage (not NOT_RUN)
and keep the supervisor's last lines in output.log. Stdlib only (no pexpect).
Mac facts are mocked; the signal path, supervise.pl, tee and traps are real."""
import os, pty, select, signal, tempfile, time, unittest
from pathlib import Path

BASE = Path(os.environ.get('MACDIAG_SRC') or Path(__file__).resolve().parents[2])

SCRIPT = r'''
export MACDIAG_REPORT_DIR="%(d)s"
. diagnostics_v2/run.sh
profile_detect(){ KERNEL=Darwin;CPU=intel;ARCH=x86_64;MODEL=MacBookPro16,1;RAM_BYTES=68719476736;OS_KEY=catalina;OS_VERSION=10.15.7;OS_BUILD=QA;ENVIRONMENT=full;MODEL_PROFILE=auto;OS_PROFILE=auto;ENV_PROFILE=auto;RAM_BACKEND=native_candidate;PROFILE_ID=qa;PROFILE_POLICY=adaptive; }
selftest_main(){ passed TOOLKIT_CHECKED; };snapshot_main(){ result OBSERVED 5 X ru en; };power_main(){ result OBSERVED 5 X ru en; }
ram_main(){ capture 30 /bin/bash -c 'echo ENGINE_RUNNING; sleep 30'; return $?; }
main acceptance; exit $?
'''

class InterruptTests(unittest.TestCase):
    def test_ctrl_c_records_interrupted_stage(self):
        d = Path(tempfile.mkdtemp())
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(BASE); os.execvp('/bin/bash', ['/bin/bash', '-c', SCRIPT % {'d': d}])
        buf, sent, t0 = b'', False, time.time()
        while time.time() - t0 < 20:
            r, _, _ = select.select([fd], [], [], 0.2)
            if r:
                try: data = os.read(fd, 4096)
                except OSError: break
                if not data: break
                buf += data
                if not sent and b'ENGINE_RUNNING' in buf:
                    time.sleep(0.5); os.write(fd, b'\x03'); sent = True
        else:
            os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
        self.assertTrue(sent, buf.decode(errors='replace'))
        self.assertEqual(os.waitstatus_to_exitcode(status), 130)
        session = next(d.glob('macdiag-v2.*'))
        summary = (session / 'summary.tsv').read_text()
        report = (session / 'REPORT_RU_EN.md').read_text()
        self.assertIn('RAM_QUICK\tINCONCLUSIVE\tINTERRUPTED\t', summary)          # stage that ran is recorded
        self.assertIn('| RAM_QUICK | INCONCLUSIVE | INTERRUPTED |', report)
        self.assertNotIn('| RAM_QUICK | NOT_RUN |', report)                        # ...and is not "never executed"
        log = next(session.glob('RAM_QUICK.*/output.log')).read_text()
        self.assertIn('SUPERVISOR_EXIT=130', log)                                  # tail not lost with tee

if __name__ == '__main__':
    unittest.main()
