#!/usr/bin/python
# -*- coding: utf-8 -*-
"""Foreground launchd supervisor. Exact user intent persists across restart.

One process, one network-mutating operation, shared legacy command lock.
No automatic update installer or GUI is run inside this privileged loop.
"""
from __future__ import print_function, unicode_literals
import binascii
import json
import os
import signal
import sys
import time
from service_common import (BASE, PRIVATE, SERVICE, CONTROL, STATUS, CLOCK,
    ServiceError, Busy, Cancelled, control, change_intent, cancel_check,
    write_json, read_json, locked, require_host, load_runtime, run, journal, read_checked)
from service_policy import Policy
from macos_adapter import MacAdapter

VERSION = '0.1.0-preview'
LABEL = 'ru.pioner22.bigsur-vpn.supervisor'
HALT = False
LAST_EVENT = None


def publish(phase, generation, policy=None, problem=None):
    global LAST_EVENT
    value = {'schema': 1, 'version': VERSION, 'phase': phase, 'generation': generation,
             'checked_at': time.time(), 'failures': policy.failed if policy else 0,
             'profile_id': policy.selected if policy else None,
             'incident': (generation if phase in ('local_error', 'stop_failed', 'pause_failed') else (policy.incident if policy else None)),
             'problem': problem, 'kill_switch': False}
    # Deliberately no address, name, username, password, subscription URL or stderr.
    write_json(STATUS, value, 0o644)
    signature = (phase, generation, value['profile_id'], value['failures'], value['incident'], problem)
    if signature != LAST_EVENT:
        journal(value); LAST_EVENT = signature


def one_round(policy, adapter, node, started):
    """Shared engine exercised by tests with injected adapters and clocks."""
    if policy.stopped: return 'stopped'
    success = adapter.probe(node, policy.phase == 'active')
    action = policy.result(success)
    if action == 'activate':
        try:
            verified = adapter.activate(node)
        except Cancelled: raise
        except Exception:
            # A failed cleanup is fatal, not permission to start another TUN.
            adapter.disconnect()
            verified = False
        policy.applied(verified)
        action = 'connected' if verified else 'next'
    elif action == 'next':
        adapter.disconnect()
    policy.schedule(started, CLOCK())
    return action


def daemon():
    global HALT
    require_host()
    adapter, policy, generation, ids = None, None, None, {}
    offline_since, offline_incident = None, None
    settled = None
    with locked(PRIVATE + '/supervisor.lock'):
        try:
            while not HALT:
                intent = control()
                if intent['generation'] != generation:
                    if adapter: adapter.close_probe()
                    generation = intent['generation']
                    settled = None
                    adapter = MacAdapter(generation)
                    policy = None
                    offline_since = None
                    offline_incident = None
                if not intent['enabled'] or intent['paused']:
                    if settled == generation:
                        time.sleep(0.25)
                        continue
                    try:
                        with locked(PRIVATE + '/command.lock'):
                            if not intent['enabled']: adapter.disconnect()
                            else: adapter.close_probe()
                            phase = ('local_error' if intent.get('fault') else 'paused') if intent['paused'] and intent['enabled'] else 'stopped'
                            publish(phase, generation, problem=intent.get('fault'))
                            settled = generation
                    except Busy:
                        publish('waiting_for_operation', generation)
                    except Exception:
                        publish('stop_failed' if not intent['enabled'] else 'pause_failed', generation, problem='cleanup_failed')
                    time.sleep(0.5)
                    continue
                if policy is not None and not policy.ready(CLOCK()):
                    time.sleep(0.1)
                    continue
                try:
                    with locked(PRIVATE + '/command.lock'):
                        adapter.check()
                        if policy is None:
                            nodes = adapter.nodes()
                            ids = dict((n['id'], n) for n in nodes)
                            policy = Policy([n['id'] for n in nodes])
                            policy.adopt(adapter.current_id())
                        started = CLOCK()
                        if not adapter.network_available():
                            policy.network_wait()
                            if offline_since is None: offline_since = started
                            if started - offline_since >= 20:
                                if offline_incident is None:
                                    offline_incident = binascii.hexlify(os.urandom(16)).decode('ascii')
                                policy.incident = offline_incident
                            publish('waiting_for_network', generation, policy, 'physical_link_unavailable')
                            policy.schedule(started, CLOCK())
                        else:
                            offline_since = None; offline_incident = None
                            action = one_round(policy, adapter, ids[policy.selected], started)
                            publish('connected' if action == 'connected' else 'searching', generation, policy)
                except Busy:
                    # Manual commands never count as failed probes.
                    time.sleep(0.2)
                except Cancelled:
                    # Re-read persistent intent; no old-generation success is published.
                    pass
                except Exception:
                    # Configuration/integrity/helper failure is not network failure.
                    # Freeze connection automation until an explicit user restart.
                    try: adapter.close_probe()
                    except Exception: pass
                    intent = change_intent(paused=True, fault='adapter_or_configuration_failed')
                    publish('local_error', intent['generation'], problem='adapter_or_configuration_failed')
                time.sleep(0.1)
        finally:
            if adapter: adapter.close_probe()
            # A supervisor crash/restart must NOT disconnect a healthy core.
            # Persistent enabled/paused intent remains authoritative.


def request(command):
    require_host()
    if command == 'logs':
        path = PRIVATE + '/supervisor-events.jsonl'
        text = read_checked(path, 2 * 1024 * 1024, private=True).decode('utf-8')
        print(text[-16384:]); return 0
    if command == 'status':
        value = read_json(STATUS, private=False)
        value['intent'] = control()
        if os.path.exists(SERVICE + '/update-status.json'):
            value['updater'] = read_json(SERVICE + '/update-status.json', private=False)
        print(json.dumps(value, ensure_ascii=True, indent=2)); return 0
    if command == 'on': intent = change_intent(enabled=True, paused=False)
    elif command == 'off': intent = change_intent(enabled=False, paused=False)
    elif command == 'pause': intent = change_intent(paused=True)
    elif command == 'resume': intent = change_intent(paused=False)
    else: raise ServiceError('Unknown service command')
    if command in ('on', 'resume'):
        print('SUPERVISOR_REQUEST_ACCEPTED'); return 0
    deadline = CLOCK() + 60
    expected = 'stopped' if command == 'off' else 'paused'
    while CLOCK() < deadline:
        state = read_json(STATUS, private=False) if os.path.exists(STATUS) else {}
        if state.get('generation') == intent['generation']:
            if state.get('phase') == expected: print('SUPERVISOR_' + expected.upper()); return 0
            if state.get('phase') in ('stop_failed', 'pause_failed', 'local_error'):
                raise ServiceError('Cleanup was not confirmed; reconnect remains disabled')
        time.sleep(0.1)
    raise ServiceError('No service acknowledgement; reconnect intent remains disabled/paused')


def handle_signal(signum, frame):
    global HALT
    HALT = True
    raise Cancelled('Supervisor is terminating')


def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGHUP, handle_signal)
    os.umask(0o077)
    try:
        if len(sys.argv) != 2: raise ServiceError('Use daemon|on|off|pause|resume|status|logs')
        return daemon() if sys.argv[1] == 'daemon' else request(sys.argv[1])
    except Cancelled: return 0
    except Exception:
        # No raw exception: subprocess/profile errors may contain secrets.
        print('SERVICE_ERROR: inspect root-owned state; operation not confirmed', file=sys.stderr)
        return 1

if __name__ == '__main__': sys.exit(main() or 0)
