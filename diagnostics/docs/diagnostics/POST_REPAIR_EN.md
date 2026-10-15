# Post-repair acceptance — 2.0.0-rc1

Option 16 runs a **non-destructive** acceptance workflow. It never erases a partition or opens a raw/block device. Options 1/13 and direct legacy SSD launch are quarantined pending a separate RAW-engine audit. Original mhdd_v2.part* files are retained, not safe standalone entry points. Options 17/18 run a new temporary-file test and an explicitly authorized 40 GiB external RAM/disk bridge, respectively.

Native tests require full Intel macOS and installed Command Line Tools. Model/running-OS profiles remain selectable in option 15; manual selection never changes the real hardware or grants permission to an unknown environment. Recovery/no compiler/mlock refusal/timeouts are INCONCLUSIVE, not DRAM failures. No tools are installed automatically, no sudo or security-setting changes are performed.

## Corrections

All network variables are local. Each retry receives a new byte counter and SHA-256 process; curl itself uses `--retry 0`. A recovered interrupted transfer is not a clean PASS. Exact body length, every pipeline status, SHA-256, final HTTP code and exact Content-Range are checked. Ignored Range is a protocol limitation. This is a Range integrity test, not a complete `curl -C` resume/reassembly test. Dedicated assets are still publication-dependent; fallback coverage remains INCONCLUSIVE.

RAM-only and bridge results are independent. A bridge failure cannot become an overall PASS or automatically identify DRAM. The C RAM verifier uses a fixed guarded mmap allocation, volatile accesses and required mlock. Full mode implements 134 patterns, including 64 full-buffer walking-one and 64 walking-zero patterns. Physical addresses and all-DRAM coverage are not claimed. Old Perl logs remain observations requiring independent attribution, not proof of a specific chip or proof of a software defect.

GPU builds use fresh paths and check compiler success before executing. The experimental Metal test checks eight patterns across 256 MiB of private buffers per enumerated device, with shared readback and command-status checks. It does not isolate physical VRAM; GPU execution has not been validated on real hardware here.

File mode creates an exclusive new file, verifies every 64-bit word, requests and checks macOS F_NOCACHE/F_FULLFSYNC, reopens and reads twice after each of two writes. Default size is 1 GiB. Bridge mode locks a 40 GiB source, verifies it before and after writing, and checks the file independently. It requires 64 GiB RAM and a verified external target. Cache-control success does not prove cold NAND retention. Only the test's own file is removed; mismatch evidence is retained.

Each step returns a structured TSV result and a matching exit status. Empty exit 0, crashes, unavailable coverage and observational commands cannot masquerade as hardware PASS. Logs are written during execution with running/finished markers and periodic sync. Abrupt power loss can still lose buffered output. A bounded supervisor terminates its child tree, but cannot guarantee recovery from kernel/driver hangs.

A source package is pinned to a single Git commit and a manifest digest. All file lengths/digests are checked before execution. This is integrity relative to the trusted bootstrap, not a signature.

## Acceptance scope

Toolkit checks → inventory/power → quick/full native RAM → CPU → GPU → HTTPS/downloads → authorized new file → manual/independent checks. RAM/CPU failure or incomplete results gate dependent loads; GPU failure also stops further load. Clean automatic stages still leave PENDING_MANUAL. Independent RAM validation, another cold boot, Apple Diagnostics, display, sleep/wake, AC/battery, Wi-Fi/ports and repair-report verification remain required. No unattended cross-boot state machine, automatic 8–12 hour combined burn-in, GPU switching or complete physical-cell coverage is claimed.

## Validation

See QA_RESULTS.md and qa-linux.log for exact local test counts. Tests use real local TLS/curl, mock bootstrap transport, bounded native C allocations and test-only fault injection. Production builds exclude fault injection. Real macOS/Bash 3.2 execution, Metal, macOS cache controls, the user's network and large 40/48 GiB loads were not tested here. Configuring CI is not the same as obtaining a CI PASS.

Logs may include serial/network identifiers and are never automatically uploaded. In full macOS `/tmp` and swap may reside on the SSD. No claim of zero SSD writes is made. The whole diagnostics_v2 directory can be copied for offline `bash diagnostics_v2/run.sh menu`; network stages still need Internet.

Primary references:
- https://curl.se/docs/manpage.html
- https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/mlock.2.html
- https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html
