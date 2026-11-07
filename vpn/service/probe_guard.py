#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Candidate core lifetime follows the supervisor's pipe, even after SIGKILL."""
from __future__ import print_function, unicode_literals
import os
import select
import signal
import subprocess
import sys
import time
from service_common import PRIVATE, ENV, CLOCK, load_runtime, read_checked
STOP = False

def stop(signum, frame):
    global STOP
    STOP = True


def main():
    if sys.platform != 'darwin' or os.geteuid() != 0: return 1
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    rt = load_runtime()
    config = PRIVATE + '/service-probe.json'
    read_checked(config, 1024 * 1024, private=True)
    # This child deliberately stays in the guard's process group.
    with open(os.devnull, 'r+b') as null:
        p = subprocess.Popen([os.path.realpath(rt.CORE), 'run', '-c', config],
            stdin=null, stdout=null, stderr=null, env=ENV, close_fds=True)
    try:
        while not STOP and p.poll() is None:
            ready, _, _ = select.select([sys.stdin], [], [], 0.2)
            if ready and not os.read(sys.stdin.fileno(), 1): break
        return p.returncode if p.poll() is not None else 0
    finally:
        if p.poll() is None:
            p.terminate()
            until = CLOCK() + 2
            while p.poll() is None and CLOCK() < until: time.sleep(0.025)
            if p.poll() is None: p.kill()
        p.wait()

if __name__ == '__main__': sys.exit(main())
