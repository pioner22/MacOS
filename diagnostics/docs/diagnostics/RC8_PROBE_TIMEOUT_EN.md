# rc8: reject probe results after their deadline

Date: 2026-09-21. This is a prerequisite-checking software fix, not a Mac hardware diagnosis.

## Reproduced defect

The rc7 watchdog sent TERM at its deadline, but `pf_probe` returned only the child command's exit status. A command handling TERM with exit 0 could therefore turn partial output into an accepted fact through `pf_read`, or an accepted capability through `rg_probe`.

An actual small process prints `GenuineIntel`, waits for TERM and exits 0. rc7 returns success and accepts its stdout. An executable `vm_stat` double similarly prints synthetic plausible statistics before exceeding the limit; the old memory-budget calculation accepts an 8192 MiB budget. No allocation of that size, real Mac observation or hardware diagnosis is involved.

## Change

The watchdog records status 124 before sending TERM and retains it in its cleanup handler. The caller reads that status with `wait` independently of the child's result. Deadline expiry therefore returns 124 even after child exit 0. Fact/capability readers discard that output, and the memory-budget prerequisite fails closed.

Probe logs distinguish the effective `rc`, original `child_rc`, `timeout` flag and time limit. Ordinary success and non-timeout failures retain their previous meaning. The target runtime gains no new dependency.

Nine actual-process regressions cover TERM exit 0, rejected stdout, registry probes, default/ignored TERM, logging, ordinary success/failure and expired VM statistics. Seven failed before the fix; all nine passed afterwards. See [RC8_QA.md](RC8_QA.md) for full-suite evidence and reproduction commands.

The suite becomes 2.0.0-rc8; bootstrap remains 1.4 and registry data remains 2026-09-20.1. The permanent `main/st.sh` command, menu lifecycle, mandatory mlock, coverage accounting, volume/consent checks and RAW quarantine are preserved.

## Limits

Validation is local Linux software execution. Actual Recovery, Bash 3.2, Apple clang, Metal and 40–48 GiB workloads remain unvalidated. Verified prebuilt native Recovery engines are not supplied. Deadline handling cannot promise immediate termination of a blocked kernel/driver. This stage validates deadline-result propagation, not comprehensive isolation of every possible system-utility process tree.
