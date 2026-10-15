#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Run only on a disposable macOS test runner, as root.
Uses a unique .invalid supplemental resolver and removes its temporary session.
Does not read vpn-profile.json, start a TUN, or connect to a provider VPN.
This is not a full Big Sur integration test.
"""
from test_vpn_compat import portable, native

if __name__ == '__main__':
    portable()
    native()
