# Текущая проверка / Current QA — 2.0.0-rc4

Итог: **177 tests in 66.388s, OK, без пропусков**. Полные условия, изменённые критерии, известные ограничения и ссылки ревизий: [RC4_REVIEW_FIXES.md](RC4_REVIEW_FIXES.md).

[Полный неизменённый журнал, gzip](qa-rc4-linux.log.gz). SHA-256 распакованного лога: `96bf013bb4d450cc275de4df4d6994c50659e9b4f436678ffd85dc63125bb95e`.

Это Linux software QA: реальные малые native/Perl операции, PTY, локальный TLS и имитация сведений Mac. Не результат испытания MacBook, Recovery или Metal. Исторические числа 71/79/93/124/140 не прибавляются к 177. Настройка workflow не означает успешного GitHub CI.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Runtime prerequisites and exact scope are documented in the release note. No complete hardware-health, power-loss durability or real macOS compatibility claim follows from these tests.
