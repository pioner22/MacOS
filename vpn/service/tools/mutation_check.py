#!/usr/bin/env python3
"""Reproducible targeted mutants, run separately from the real macOS gate."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]
MUTANTS=[
 ('threshold_9','service_policy.py','FAILURES = 10','FAILURES = 9'),
 ('do_not_reset_streak','service_policy.py','if success:\n            self.failed = 0','if success:\n            self.failed = self.failed'),
 ('do_not_wrap','service_policy.py','(self.index + 1) % len(self.ids)','min(self.index + 1, len(self.ids)-1)'),
 ('ignore_stop','service_policy.py',"if self.stopped: return 'none'","if False: return 'none'"),
 ('candidate_marked_connected','service_policy.py',"if self.phase == 'candidate': return 'activate'","if self.phase == 'candidate': return 'connected'"),
 ('premature_clear_alert','service_policy.py','if self.successes >= 3:','if self.successes >= 2:'),
 ('wrong_interval','service_policy.py','INTERVAL = 2.0','INTERVAL = 1.0'),
 ('accept_bad_signature','secure_update.py',"if rc: raise ServiceError('Publisher signature verification failed')","if False: raise ServiceError('Publisher signature verification failed')"),
 ('accept_wrong_package_hash','secure_update.py',"len(data) != manifest['size'] or hashlib.sha256(data).hexdigest() != manifest['sha256']","len(data) != manifest['size']"),
 ('ignore_feed_expiry','secure_update.py',"or not now < m['expires_at']",'or False'),
 ('notify_repeatedly','user_agent.py','incident != seen and','True and'),
 ('skip_extra_ip','macos_adapter.py',"out.get('server') == '144.31.180.114'","out.get('server') == '192.0.2.123'"),
]

def execute(root):
    return subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','tests','-v'],cwd=root,
                          stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=40)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--start',type=int,default=0); parser.add_argument('--end',type=int,default=len(MUTANTS)); args=parser.parse_args()
    baseline=execute(ROOT)
    if baseline.returncode: raise SystemExit('Baseline did not pass')
    destination=ROOT/'evidence'; destination.mkdir(exist_ok=True)
    (destination/'baseline.txt').write_bytes(baseline.stdout)
    results=[]
    with tempfile.TemporaryDirectory(prefix='vpn-supervisor-mutations-') as folder:
        work=Path(folder)/'source'
        shutil.copytree(ROOT,work,ignore=shutil.ignore_patterns('__pycache__','evidence'))
        for ident,name,old,new in MUTANTS[args.start:args.end]:
            path=work/name; original=path.read_text()
            if original.count(old)!=1: raise ValueError('Ambiguous mutation anchor: '+ident)
            changed=original.replace(old,new); compile(changed,name,'exec'); path.write_text(changed)
            started=time.monotonic()
            try:
                result=execute(work)
                output=result.stdout.decode('utf-8','replace')
                state='survived' if result.returncode==0 else ('killed' if 'FAIL:' in output and 'ERROR:' not in output else 'runner_error')
                (destination/(ident+'.txt')).write_bytes(result.stdout)
            except subprocess.TimeoutExpired: state='timeout'
            finally: path.write_text(original)
            entry=dict(id=ident,file=name,result=state,seconds=round(time.monotonic()-started,3))
            results.append(entry); print(json.dumps(entry),flush=True)
    (destination/('mutations-%s-%s.json' % (args.start,args.end))).write_text(json.dumps(results,indent=2)+'\n')
    return 0 if all(r['result']=='killed' for r in results) else 1
if __name__=='__main__': sys.exit(main())
