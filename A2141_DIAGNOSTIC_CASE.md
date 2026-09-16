# MacBook Pro 16-inch A2141 — diagnostic case

Date: 2026-09-16

## Hardware under test

- MacBook Pro 16-inch, 2019 (A2141, Intel/T2)
- Internal SSD: `APPLE SSD AP1024N`, 1 TB class
- Installed RAM reported by `hw.memsize`: 64 GiB

## Initial symptoms

Observed during recovery/installation work:

- APFS corruption requiring data rescue and reformatting;
- intermittent macOS installation/download failures;
- occasional connection/download interruption in Internet Recovery;
- `curl`/Recovery process instability including `malloc` checksum / `Abort trap` class symptoms;
- occasional hangs/reboots;
- suspected visual anomalies around preboot/Recovery progress display;
- large-file hash anomalies during earlier diagnostics.

Apple Diagnostics previously returned `ADP000`; this does not supersede later direct data-integrity failures found by the custom RAM test.

## SSD evidence

A destructive deterministic full-device Pattern A pass was completed over the logical LBA space exposed by T2/FTL.

Observed result:

```text
WRITE_PATTERN_A_IO_ERRORS=0
VERIFY_PATTERN_A_IO_ERRORS=0
VERIFY_PATTERN_A_HASH_ERRORS=0
PATTERN_A_WRITE_VERIFY=PASS
STAGE=COMPLETE_A
```

This means the full logical device accepted the deterministic write and an immediate full read-back matched the expected SHA-256 data for every checked chunk.

A pre-write sequential read also completed with `IO_ERRORS=0`. One severe latency outlier was observed near chunk 8233 / byte offset 552507277312, but the machine had entered sleep during testing, so that latency event alone is not accepted as evidence of defective NAND.

Status: **no direct SSD data-integrity failure has yet been demonstrated**. Hidden NAND reserve managed by T2/FTL is not directly addressable.

## RAM evidence

### First independent run

A userspace RAM pattern test detected a data mismatch. A location written with a known pattern did not read back identically.

### Subsequent cold/restarted run

The maximum RAM test failed again on the simple `ONES` (`0xFF`) pattern using only an 8 GiB allocation. Multiple pages/chunks reported persistent data mismatch, with repeated rereads continuing to fail.

Representative result form:

```text
RAM_CHUNK_MISMATCH pattern=ONES ...
RAM_BAD_PAGE ... differing_bytes=1 expected_hex=FF actual_hex=...
RAM_BAD_PAGE_REREAD ... result=FAIL
RAM_PATTERN_RESULT pattern=ONES errors=11
RAM_HARD_FAIL
```

The diagnostic intentionally exited non-zero after detecting real data corruption; the non-zero exit was not a crash of the script.

Status: **hardware memory-subsystem fault is strongly suspected / high probability**.

The test does not by itself identify the exact board component. Possible fault domains include:

- soldered DRAM package(s);
- DRAM BGA/interconnect;
- memory power rails;
- address/data routing;
- CPU integrated memory controller (IMC);
- other logic-board faults affecting memory integrity.

## Interpretation

The repeated RAM data mismatches can plausibly explain many earlier apparently unrelated symptoms, including allocator corruption, crashes, incorrect hashes, filesystem corruption after unstable operation, installer failures, and some display corruption scenarios.

They do **not** prove that every network or display symptom has the same root cause. Independent network, GPU/VRAM, power and firmware tests remain useful after or alongside memory diagnosis.

## Next diagnostic actions

1. `RAM MAP` across multiple cold boots to collect expected/actual/XOR/bit statistics.
2. Board-level memory power/BGA/IMC diagnosis if mismatches remain reproducible.
3. `GPU/VRAM TEST` from a full macOS environment with Metal + clang/CLT.
4. `NETWORK TEST` to separate Apple CDN/Wi-Fi/TLS failures from local memory corruption; failures while RAM is known bad must be interpreted cautiously.
5. Re-run complete SSD Pattern A/B + cold verification after memory subsystem repair before trusting the machine with important data.

## Launcher

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
```

See [`DIAGNOSTICS.md`](DIAGNOSTICS.md) for the complete test menu and interpretation rules.
