# MacDiag Core 0.1.0

A separate observation-first environment inventory, capability registry, adapter library and test dispatcher. Existing st.sh, vpn.sh and diagnostics_v2 are unchanged. This is an initial implementation, not a database of every Mac or a VPN installer.

```sh
bash macdiag_core/macdiag profile collect --output profile.json
bash macdiag_core/macdiag tests list --compatible
bash macdiag_core/macdiag run --suite basic
bash macdiag_core/macdiag plan --workflow vpn.install
bash macdiag_core/macdiag run --test network.ip --policy diagnostic --allow-network
bash macdiag_core/macdiag profile diff --before old.json --after new.json
```

No sudo or package installation. No automatic upload. Network probes require explicit policy and consent. Saved snapshots are accepted for plans, never execution. Output files are new-only 0600. All execute paths are fixed in adapters, never evaluated from registry JSON. Unknown evidence stays unknown; profile overrides may restrict, not invent facts.

Bash 3.2+ entry point; existing system Perl and core JSON::PP/Digest::SHA/POSIX/IO::Select/Time::HiRes/Fcntl/Encode capabilities required. The wrapper emits a minimal UNKNOWN report if these are unavailable. Python is only used by developer tests. No universal Recovery dependency availability is assumed.

The seed registry has 13 documented device rows for 11 Model Identifiers, 9 composition rules, and 11 operation contracts (7 implemented, 4 explicitly blocked). Duplicate Model Identifiers retain multiple candidate years. No target hardware certification is claimed. Runtime reports keep running OS/build, process architecture, translated-process evidence, tool revisions and compatibility fingerprint separate from dynamic networking.

Implemented: metadata, tool inventory, route observation, DNS summary, launchd service query, GitHub HTTPS probe, ifconfig.me IPv4 probe. Planned/blocked: VPN installation, bandwidth measurement, storage tests, memory stress. DNS summary is not a leak audit; a changed IP is not VPN proof. Plans are not execution results.

Exit codes: 0 completed, 1 failure/error, 2 incomplete/blocked/skipped or missing engine. Local validation: 98 Perl checks plus 14 Python CLI tests on Linux, with macOS APIs mocked. Real Bash 3.2, Big Sur/Recovery system Perl, Apple Silicon/Rosetta, macOS networking and launchd remain untested. Start target testing with profile collection only.

Process runner limits time/output and cleans its anchored process group. Independently detached sessions are outside its contract. It is not a security sandbox for arbitrary programs; local file hashing and total collector duration do not have a global watchdog.

See README_RU.md for full architecture, integration gates and primary sources. No secrets or user device reports belong in this public source tree.
