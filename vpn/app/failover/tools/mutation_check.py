#!/usr/bin/env python3
"""Targeted policy mutants; real Swift compile/tests in an isolated copy.
Not a whole-program mutation score. No sockets, app, VPN or macOS operations.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('Sources/ConnectionPolicy/FailoverPolicy.swift')
MUTANTS = [
    ('interval_3s', 'let interval: TimeInterval = 2', 'let interval: TimeInterval = 3'),
    ('timeout_3s', 'let probeTimeout: TimeInterval = 2', 'let probeTimeout: TimeInterval = 3'),
    ('threshold_9', 'let failuresBeforeSwitch = 10', 'let failuresBeforeSwitch = 9'),
    ('switch_after_11', 'consecutiveFailures >= Self.failuresBeforeSwitch', 'consecutiveFailures > Self.failuresBeforeSwitch'),
    ('success_does_not_reset', 'consecutiveFailures = 0\n        if scope', 'consecutiveFailures += 0\n        if scope'),
    ('always_select_first', 'index = (index + 1) % servers.count', 'index = 0'),
    ('expired_probe_not_cancelled', 'effects.append(.cancel(operation.ticket))', '// mutation: cancellation missing'),
    ('deadline_exclusive', 'now >= operation.ticket.deadline', 'now > operation.ticket.deadline'),
    ('late_probe_accepted', 'guard now < current.deadline else { return try tick(now: now) }\n        pending = nil\n        if !reachable', 'guard now <= current.deadline else { return try tick(now: now) }\n        pending = nil\n        if !reachable'),
    ('stale_probe_accepted', 'current == attempt else { return [] }\n        try observe(now)\n        guard now < current.deadline else { return try tick(now: now) }\n        pending = nil\n        if !reachable', 'current == current else { return [] }\n        try observe(now)\n        guard now < current.deadline else { return try tick(now: now) }\n        pending = nil\n        if !reachable'),
    ('false_connected_after_activation', 'activeServerID = current.serverID\n        phase = .checking', 'activeServerID = current.serverID\n        phase = .connected'),
    ('stop_does_not_cancel', 'if let old = pending { effects.append(.cancel(old.ticket)) }', '// mutation: cancellation missing'),
    ('failed_stop_claims_stopped', 'phase = succeeded ? .stopped : .stopFailed', 'phase = .stopped'),
    ('old_generation_retained_on_stop', 'generation = UUID()\n        consecutiveFailures = 0\n        phase = .stopping', '// mutation: generation retained\n        consecutiveFailures = 0\n        phase = .stopping'),
    ('candidate_uses_active_scope', 'activeServerID == server ? .activeTunnel : .candidate', 'activeServerID == server ? .activeTunnel : .activeTunnel'),
    ('activation_failure_no_delay', 'nextProbeAt = now + Self.interval\n            return moveToNext()', 'nextProbeAt = now\n            return moveToNext()'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--only', nargs='*', help='Optional named subset for bounded batches')
    args = parser.parse_args()
    if shutil.which('swift') is None:
        parser.error('swift toolchain is required')
    args.output.mkdir(parents=True, exist_ok=True)
    selected = MUTANTS if args.only is None else [m for m in MUTANTS if m[0] in args.only]
    if args.only and len(selected) != len(set(args.only)):
        parser.error('Unknown mutant name')
    original = (ROOT / SOURCE).read_text()
    results = []
    with tempfile.TemporaryDirectory(prefix='vpn-failover-mutants-') as temp:
        work = Path(temp) / 'package'
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns('.build', '.git', '__pycache__'))
        env_log = subprocess.check_output(['swift', '--version'], text=True)
        for name, old, new in [('baseline', '', '')] + selected:
            if name != 'baseline' and original.count(old) != 1:
                raise ValueError('Mutation anchor is not unique: ' + name)
            mutated = original if name == 'baseline' else original.replace(old, new, 1)
            (work / SOURCE).write_text(mutated)
            start = time.monotonic()
            try:
                p = subprocess.run(['swift', 'test'], cwd=work, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, timeout=60)
                output = p.stdout
                if p.returncode == 0:
                    state = 'baseline_pass' if name == 'baseline' else 'survived'
                elif "Test Suite 'All tests' failed" in output:
                    state = 'killed'
                else:
                    state = 'build_or_runner_error'
                code = p.returncode
            except subprocess.TimeoutExpired as error:
                output = error.stdout or b''
                if isinstance(output, bytes):
                    output = output.decode('utf-8', 'replace')
                state, code = 'timeout', None
            (args.output / (name + '.log')).write_text(output)
            results.append({'name': name, 'state': state, 'returncode': code,
                            'seconds': round(time.monotonic() - start, 3),
                            'original': old, 'replacement': new})
            print(name + ': ' + state, flush=True)
            if name == 'baseline' and state != 'baseline_pass':
                break
    report = {'source_sha256': hashlib.sha256(original.encode()).hexdigest(),
              'toolchain': env_log, 'scope': 'ConnectionPolicy only; 16 targeted single edits',
              'results': results}
    (args.output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
    return 0 if len(results) == len(selected) + 1 and all(
        r['state'] in ('baseline_pass', 'killed') for r in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
