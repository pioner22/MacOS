# Mac diagnostics audit — 0.2.0-audit

Baseline: `pioner22/MacOS@9a10de61041d7d9dd87abecd01eba7e5c24f12a7`. Date: 2026-09-19.
Scope: diagnostic shell/Perl/Metal code, not the unrelated Electron client or the user's hardware.

**Experimental review build, not a commercially qualified release.** Keep it on the review branch until the macOS/Recovery validation gates are completed.

## Confirmed defects and mitigations

The baseline downloader's `own_fixture` and `stream_check` share global `H` and `N`. After the first call, subsequent requests use a numeric filename and a temporary path as the expected digest. This was reproduced in a reduced exact-logic test. New parameters are local.

Retrying curl into an existing hash pipeline can concatenate a failed partial response and a complete retry. A real local TLS server reproduced `abcabcdef` instead of `abcdef`, with curl returning 0. New payload transfers use `--retry 0`; separate attempts create separate hash processes.

The greedy boot-time parser selects `usec`, not `sec`. A regression verifies that `{ sec = 1760000000, usec = 197083 }` returns seconds. A new boot timestamp does not prove complete power loss or T2 reset.

The old destructive RAW backend is quarantined, not declared repaired. Its countdown consent, APFS root-device identification, ignored unmount errors in resume branches, automatic formatting, and unqualified checkpoint behavior require a separate redesign and device-emulator tests. The active storage entry is an allocated-file test only. It never writes a raw device or silently resumes the old Pattern A workflow.

Predictable temporary paths and fixed RESCUE filenames are replaced in the active package by private random directories. The new file-I/O engine uses an exclusive regular file, refuses /dev, checks free space, preserves failure evidence, and never overwrites an existing user file. It requires explicit operator confirmation.

The loader resolves one commit and verifies each packaged file's size and SHA-256 before execution. This prevents mixed revisions; it is not a cryptographic publisher-signature scheme.

Network integrity now checks actual byte count, HTTP response, content encoding, and exact Content-Range. An unsupported range is not called a DRAM fault. Range checking is not a complete interrupted-file resume/reassembly implementation. Missing fixtures produce INCONCLUSIVE, not a silently substituted full PASS.

Compiler status and unique output paths prevent stale GPU binaries from executing after failed compilation. Metal command objects and completion state are checked. Its readback still depends on system RAM.

Observation-only checks return a separate state. Incomplete execution, OOM, signals, missing completion markers, and log failures must not become hardware PASS. A failed auxiliary I/O test is no longer hidden behind a successful RAM result.

## Memory evidence and independent engine

Earlier screenshots record mismatches reported by the Perl tests. They are serious observations, but are not independent proof of a specific DRAM-chip defect. Virtual allocation offsets cannot identify chips, BGA joints, channels, or physical addresses. Repeated reads can hit caches; identical event counts do not establish identical physical pages. The identified downloader bugs do not prove that the RAM mismatches were software-generated either.

The new C engine uses mmap, guard pages, volatile accesses, checked mlock, address-dependent values, and real 64-step walking-one/64-step walking-zero patterns. Failed mlock is reported as a coverage limit. Neither locked pages nor this userspace program provide coverage of every DRAM cell, firmware/T2 memory, or cache bypass. The Recovery Perl fallback is labelled screening rather than a physical DRAM map.

## Executed validation

47 regression tests passed in a Linux x86-64 environment. They cover strict C compilation, RAM patterns, injected defects, cancellation, file-I/O evidence retention, refusal of device paths, user-file preservation, result-state handling, package hashes/syntax, local HTTPS, corruption, truncation, missing fixtures, and Range behavior.

All five fixture SHA-256 values and the 16 MiB range digest were recomputed from the deterministic SHAKE-256 generator. This is not a claim that release assets were published or downloaded from the user's network.

AddressSanitizer and UndefinedBehaviorSanitizer runs passed for 16 MiB RAM (two quick rounds) and 16 MiB file I/O. No real raw devices were written. The user's Mac was not tested.

macOS/Bash 3.2 runtime, Recovery, Metal compile/runtime, T2, large physical allocations, whole-device storage, reboot/power-loss persistence, and real display hardware remain unverified here. A Linux/macOS Intel CI workflow is provided; its existence is not a successful CI result.

## Commercial release gates

Validate against independent tools and known-good/known-bad hardware. Implement a separately reviewed RAW-device backend, resource/process supervision, durable structured logs with explicit coverage and privacy controls, signed versioned binaries/updates, and an offline Recovery package. Percentages of installed memory alone do not prevent OOM on busy machines. A physical display diagnosis cannot be inferred uniquely from a screenshot.

The existing repository license is GPLv3. Commercial sale is allowed subject to its obligations. Proprietary or dual licensing needs a rights/provenance review; previous GPL grants do not disappear. No license change was made by this audit.

Primary references: GNU Bash manual; curl manpage; Apple mlock and Metal storage-mode documentation; Apple Developer ID guidance; GNU GPL FAQ. URLs are listed in the Russian audit report.
