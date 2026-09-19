# Validation / Проверка — 2.0.0-rc1

Date: 2026-09-19. Actual local command:

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

**71 tests passed, 0 failures, 0 errors (31.914 seconds).** Exact output: [qa-linux.log](qa-linux.log).

The run used Linux, Bash 5.2, Python unittest, system cc, curl, Perl and a local TLS HTTP server. RAM/file engines were actually compiled with `-std=c11 -O2 -Wall -Wextra -Werror` and executed on small (1 MiB) test allocations. Test-only builds injected one changed bit/byte. Production builds were checked to ignore those test environment variables. Native full-pattern verification exercised all 134 patterns at that small allocation size.

Covered: per-call URL/hash scope, complete/corrupt/overlong/truncated transfers, timeout and fresh retry, 404, exact/ignored/wrong/missing Content-Range and redirects, byte counting, known hashes, absent/malformed result contracts, unexpected exit after PASS, FAIL priority, observations/manual outcomes, supervisor timeout/cancellation, mlock failure, allocation argument bounds, file corruption after clean bridge pre/post RAM checks, control-file preservation, raw-path refusal, syntax, profile contradictions, bootstrap/alias tampering and truncation, manifest completeness.

The five 1/8/32/128/512 MiB fixture SHA-256 references and the 16 MiB range reference were regenerated independently with SHAKE-256. No real downloads from GitHub Release or the user's network were performed by these regressions. Bootstrap/alias tests use a local file-copy transport mock, not HTTPS to GitHub.

**Not validated:** real macOS/Recovery/Bash 3.2, Metal compilation/execution, Apple F_NOCACHE/F_FULLFSYNC behavior, full 40 GiB bridge, full 48 GiB RAM load, stability after power cycles, physical-chip attribution, the old RAW engine, or automatic unattended long-duration combined burn-in. Correct Linux file verification deliberately returns INCONCLUSIVE for macOS-specific cache controls. Actual hardware acceptance remains pending.

Legacy profile tests under `tests/test_diagnostic_profile.py` / `tests/test_profile_entrypoints.py` describe the v1 implementation; the old 35-test claim is not a v2 result. Use the explicit v2 discovery command above. Old scripts' names now route to v2, and destructive aliases return BLOCKED. A workflow configuration is provided separately; this local result is not a claimed GitHub Actions success.

RU: Это проверка программной логики, не подтверждение исправности ноутбука. После ремонта сначала проверяются меню/профиль и self-test; затем нативные тесты в полной macOS и независимая проверка. Ограничение инструмента или среды не превращается в аппаратный FAIL. Не передавайте ноутбук на повторную перепайку по одному выводу самописного теста без независимого воспроизведения.

Pinned source package: `1b4e0677e58641255ab69931169effc0693aeee9`.
Pinned bootstrap: `64f8c220bbf6d88a0c0dd1d000127d96e31d494b`.
Manifest SHA-256: `6c4d4421165f2a270eababffd79480345c0b7b2e587bdf2319027ba4f90d206a`.
