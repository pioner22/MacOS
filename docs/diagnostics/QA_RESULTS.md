# Executed QA / Фактическая проверка

Date: 2026-09-19. Host: Linux x86-64 sandbox, not the user's Mac.

- Python unittest: **47 tests, OK**. Final run output: `qa-linux.log`.
- Compiler flags: `-std=c11 -O2 -Wall -Wextra -Werror` for both C engines, with and without test-only injection.
- AddressSanitizer + UndefinedBehaviorSanitizer: RAM 16 MiB, two quick rounds, exit 0; file-I/O 16 MiB, exit 0.
- Local real HTTPS/curl test reproduced a legacy partial-payload/retry concatenation with final curl exit 0.
- Five SHAKE-derived fixture SHA-256 constants and the Range constant were recomputed and matched.
- Source-package Bash/Perl syntax and SHA-256 manifest validated.

Not performed here: actual MacBook RAM/SSD/VRAM diagnostics, macOS/Bash 3.2 runtime, Metal compilation, Internet Recovery execution, T2 firmware or power-loss testing. GitHub Actions results must be checked separately; the workflow file itself is not proof of successful CI.

No destructive access to physical storage was performed. File tests used only temporary newly created files. Injected memory/file corruption was explicitly test-only; production C builds exclude injection support.

The first local test run found a classifier issue: TLS truncation can return curl 56, not only 18. The implementation was corrected to record incomplete payload length as well as the actual curl code. The final test run passed without weakening the expected truncation check.
