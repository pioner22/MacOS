#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Small deterministic state machine; callers supply monotonic time and real outcomes."""
from __future__ import unicode_literals
import uuid

class Policy(object):
    INTERVAL = 2.0
    FAILURES = 10
    def __init__(self, ids):
        if not ids or len(ids) != len(set(ids)) or len(ids) > 264:
            raise ValueError('Nonempty unique bounded profile list required')
        self.ids = list(ids)
        self.index = 0
        self.failed = 0
        self.due = 0.0
        self.phase = 'candidate'
        self.visited = set()
        self.incident = None
        self.successes = 0
        self.stopped = False

    @property
    def selected(self): return self.ids[self.index]

    def adopt(self, active):
        if active in self.ids:
            self.index = self.ids.index(active)
            self.phase = 'active'

    def ready(self, now): return not self.stopped and now >= self.due

    def schedule(self, started, finished):
        # No catch-up bursts after sleep or a delayed timer.
        self.due = max(started + self.INTERVAL, finished)

    def result(self, success):
        if self.stopped: return 'none'
        if success:
            self.failed = 0
            self.successes += 1
            if self.phase == 'candidate': return 'activate'
            if self.successes >= 3:
                self.visited.clear(); self.incident = None
            return 'connected'
        self.successes = 0
        self.failed += 1
        if self.failed < self.FAILURES: return 'retry'
        self.advance()
        return 'next'

    def advance(self):
        if self.stopped: return
        self.visited.add(self.selected)
        if len(self.visited) == len(self.ids) and self.incident is None:
            self.incident = uuid.uuid4().hex
        self.index = (self.index + 1) % len(self.ids)
        self.failed = 0
        self.successes = 0
        self.phase = 'candidate'

    def applied(self, verified):
        if self.stopped: return
        if verified:
            self.phase = 'active'; self.failed = 0; self.successes = 1
        else:
            # Local activation failure is not fabricated as ten network failures.
            self.advance()

    def network_wait(self):
        self.failed = 0
        self.successes = 0

    def stop(self):
        self.stopped = True
        self.failed = 0
        self.incident = None
        self.phase = 'stopped'
