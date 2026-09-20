# Validation record — MacDiag Core 0.1.0

Date: 2026-09-20. Execution host: Linux, Bash 5.2.37, Perl 5.40.1, Python 3.13.5.

## Executed

- `bash macdiag_core/tests/run.sh`: PASS.
- Perl syntax checks for the four libraries and dispatcher: PASS.
- Bash syntax check for the local entry point: PASS.
- `prove -I lib tests/*.t`: 3 files, 98 assertions, PASS.
- Python CLI unittest: 14 tests, PASS.
- Actual offline profile collection on this Linux host: completed; classified as unknown-observe, not as macOS.
- A real test with a TERM-ignoring descendant verifies that the process-group runner stops further execution after timeout. This is not a guarantee against an intentionally detached session.
- Actual relative-path JSON export and refusal to overwrite an existing file: PASS, mode 0600.

macOS commands, service state, DNS state and device identities are simulated in portable tests. No HTTP, VPN-provider or bandwidth test is included in these counts. Tests do not use the publicly stored VPN subscription.

## Not executed / not certified

- Bash 3.2 interpreter.
- System Perl and core-module availability on Big Sur or any Recovery image.
- Actual Apple Silicon/Rosetta detection.
- Native route/scutil/launchctl operations on a Mac.
- Real macOS HTTPS/IP adapters.
- Disk, memory or GPU hardware tests.
- Existing VPN or diagnostics regression suites; their files are unchanged.

No REAL_HARDWARE_VALIDATED entry exists. This release supplies the collector needed to obtain the first real device/environment snapshots without making network or disk configuration changes.

## Reproduce

From the repository root:

```bash
bash macdiag_core/tests/run.sh
bash macdiag_core/macdiag profile collect --output new-profile.json
```

Developer tests require Python 3; the runtime does not. Target-device validation should start with profile collection without `--allow-network`. The profile remains local unless explicitly shared.
