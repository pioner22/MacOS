# CI status — 2026-09-19

Code commit: 5215907540c2ed78c4e1c0399e4355e5a95d3063.
Workflow: Diagnostics v2 regression.
Run: https://github.com/pioner22/MacOS/actions/runs/35450739184

GitHub API reported both matrix jobs failed with **steps=[] and runner_id=0**:
- regression (macos-15-intel), job 105917325095;
- regression (ubuntu-22.04), job 105917325227.

No regression command or Metal build step executed in this run. The reason the runner was not assigned has not been established from the available output. This is NOT evidence that code tests passed, and it is NOT a reproduced C/Metal compile failure.

Local results remain 79 successful regressions and successful small ASan/UBSan runs on Linux. macOS/Bash 3.2/Metal validation remains pending. Fix runner availability/permissions/account settings as appropriate after checking the actual GitHub annotation; do not presume billing or another cause without evidence.

RU: Обе CI-задачи завершились до выполнения команд, без назначенного runner. Причина по доступным данным не установлена. Локальные тесты выполнены, но прогон macOS и Metal не состоялся. Зелёный CI не заявляется.
