# Recovery-first product and support architecture — rc3

The primary scenario is Terminal inside Recovery with no installed macOS. The unchanged st.sh entry performs minimal preflight, verifies one immutable package, detects hardware/process architecture/running OS/environment, probes tools, selects a composable profile, saves that profile, and only then displays the menu. A profile selection never starts stress by itself.

Nine ordered data templates combine A2141/Intel/Apple hardware families with Recovery/full/safe/ambiguous installer/unknown environments. Actual OS version, process architecture and console mode extend the template ID. Root UID does not prove Recovery; x86_64 alone does not prove Intel hardware; the installer target is not the running OS. Profiles remain SOFTWARE_TESTED_REAL_HARDWARE_PENDING, not real-Mac certified.

Recovery without a compiler uses bounded core-Perl screening where working dependencies exist: RAM quick up to 256 MiB / extended up to 1 GiB; a new consented file up to 256 MiB with two readbacks; reduced SHA execution load and HTTPS/download tests. Clean RAM/file screens remain INCONCLUSIVE because memory locking, full physical coverage and cache exclusion are not established. A data mismatch stops dependent load and never attributes a specific chip. Missing runtimes and unknown environments do not become hardware failures. Native candidates retain required mlock and a conservative vm_stat-based budget. GPU remains experimental and full-system only; RAW remains quarantined.

Verified prebuilt native binaries for x86_64/arm64 Recovery are the important next step: build on macOS, verify ABI/minimum OS/dylibs, hashes/signatures and a smoke test before large allocations. They are not supplied by this RC and must not be replaced by Linux binaries or a misleading Perl PASS. Releases can distribute such binaries without a dedicated server.

Local evidence includes bootstrap/probe logs, capabilities, environment/profile, per-stage results and a human report. Recovery /tmp may vanish on reboot. Names such as RESCUE do not establish external storage. Power-loss persistence is not guaranteed by ordinary logging or unit tests.

Option 19 exports only allowlisted metadata/status fields and an issue draft locally. No automatic upload, raw log copying, tokens, serial numbers, network addresses or user paths. Human review remains mandatory. Keep raw logs local or submit them through an explicitly agreed private channel.

Start without a server: GitHub stores code, reviews, releases and reviewed minimal issues; raw evidence stays local. A server becomes useful for managed private intake: short-lived one-time upload authorization, private object storage, metadata, quota/rate limits, archive validation, retention/deletion, access control and audited reads. Public issues receive only a sanitized summary and a correlation ID. Never embed PATs or GitHub App private keys in a client. Submission failure must not break offline diagnostics or affect hardware verdicts. A support backend must not gain arbitrary remote execution on clients.

Quality gates: immutable release provenance; simulated and real-environment validation recorded separately; negative tests for missing/broken tools, architecture, timeouts, memory/resource limits, read-only/full disks, symlinks, partial packages, network/range errors and cancellation. Keep a reproduction fixture for every bug. Real power-cycle and Recovery validation require appropriate hardware. No silently downgraded coverage or optimistic full-machine PASS.

See RECOVERY_PRODUCT_RU.md for the detailed design, implemented scope, staged roadmap and primary references. RC3_QA.md records the actual run, not an assertion of Mac hardware health.
