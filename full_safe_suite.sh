#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Compatibility entry; the verified bootstrap selects a complete frozen payload.
# Storage is FILE-ONLY; legacy destructive mhdd backends are not executed.
f=$(mktemp /tmp/macdiag-entry.XXXXXXXX) || exit 3
trap 'rm -f "$f"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
curl -q -fsSL --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 20 --max-time 120   https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh -o "$f" || exit 3
/bin/bash -n "$f" || exit 3
/bin/bash "$f" --run safe "$@"
exit "$?"
