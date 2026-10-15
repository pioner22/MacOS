# rc8 — программная проверка / software validation

Дата: 2026-09-21. Комплекс 2.0.0-rc8; загрузчик 1.4; реестр 2026-09-20.1.

## Фактическое исходное состояние

Передача контекста прочитана полностью; исходный ZIP rc7 распакован, CRC исправна, `VERIFY_BUNDLE.py` подтвердил 96 файлов и 22 файла payload. Все 91 входящий в GitHub файл архива совпали по Git blob SHA с main `e1c4bf474cf584f549ad1e004a7dd8622efa2c76`. Изменения после `59123222ce4148c6464a3c0dbc019ac5938ddbe1` относятся только к VPN. Загрузчик, manifest и весь payload rc7 совпали с `7a2ac61cf15943f3d1d4fda2c9cf9d6cf5f811c6`.

## Новые локальные прогоны

| Набор | Фактический результат |
|---|---|
| Исходный rc7, текущий сеанс | 300 tests in 83.250s, OK, без пропусков |
| Новые регрессии на исходном rc7 | 9 tests in 12.265s, 7 failures |
| Те же регрессии после исправления | 9 tests in 12.238s, OK |
| Весь набор с закреплёнными ссылками rc8 | **309 tests in 96.700s, OK, без пропусков** |

Исторические 300 tests in 63.441s относятся к предыдущему сеансу и не подменяют результаты выше. Subtests отдельно не прибавлялись. Итоговые 309 — прежние 300 плюс девять новых проверок; целевые прогоны не прибавляются повторно.

Среда: Linux x86_64, Bash 5.2.21, системный Python 3.12.3, GCC 13.3.0, Perl 5.38.2, системный curl 8.5.0. Зависимости разработческих PTY-тестов: pexpect 4.9.0 и ptyprocess 0.7.0 в отдельном каталоге. Они не входят в Recovery payload.

```bash
python3 tools/build_diagnostics_registry.py --check
python3 -m unittest discover -s tests/diagnostics_v2 -p test_probe_timeout.py -v
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Фактический полный запуск использовал `/usr/bin/python3`, PATH `/usr/bin:/bin:/usr/sbin:/sbin` и PYTHONPATH отдельного каталога pexpect/ptyprocess. Проверка генератора вернула `REGISTRY_TABLES_OK`; данные четырёх таблиц не изменились.

Новые регрессии запускают настоящие небольшие процессы и сигналы. `vm_stat` — исполняемый двойник с синтетическими данными. Старый набор включает малые реальные C/Perl операции, внесение ошибок, локальный TLS/curl и PTY; сведения Mac и отдельные отказы имитируются. Тесты wrapper-ов используют имитированный транспорт и не доказывают доступность GitHub из сети пользователя.

## Закреплённые данные

- Payload/bootstrap commit: `14656dffb0644c417b72abe2d6bb090c56f70cc2`.
- manifest.tsv SHA-256: `9e7eac877053ea8b326d4b379dabe37655be71b5be615b0c2edf48c14d95f312`.
- st.sh SHA-256: `98e4067b5e209c497bdec137a00eeb43bc5995a2cff834f8c0b2d146d3200afc`.
- Число файлов исполняемого payload: 22.

Полные журналы сохранены отдельно, без автоматической публикации сырых логов в GitHub. SHA-256 распакованных журналов:

| Журнал | SHA-256 |
|---|---|
| qa-rc8-baseline-linux.log.gz | `768ab275260f238c40c75c118e720af39853fa8f72789199347faca0a9ccce84` |
| qa-rc8-probe-before.log.gz | `50c11bd0cdf1429af80530ee1cd1131716ec0d3708465e637ff96fb2a7d7ecc1` |
| qa-rc8-probe-after.log.gz | `42690281579220f77bb9c35ad2983734ed1f9ddebc834d99cae5b12338f57cf2` |
| qa-rc8-linux.log.gz | `5d4716ebc6801f7c22c483d0a8db0ca438b9744c82bb04666381cc0772db8602` |

## Ограничения

Настоящие macOS/Recovery, Bash 3.2, Apple clang, Metal, 40–48 ГиБ нагрузки и диагностика ноутбука пользователя не выполнялись. Готовых проверенных native-бинарников для Recovery нет. ShellCheck в этом локальном сеансе недоступен. Полная изоляция деревьев процессов предварительных проб не является результатом этого исправления.

Проверенный до публикации workflow main `35563741708` завершился failure: единственная возвращённая задача `regression-linux` имеет `runner_id=0`, пустое имя runner и `steps=[]`. Это не выполненная проверка и не зелёный CI. Причина инфраструктурного отказа по этим полям не установлена. Настройки защит и workflows этим изменением не ослаблялись. Состояние CI нового PR нужно читать отдельно.

## English

Fresh rc7 baseline: 300 tests in 83.250s, OK. Nine new actual-process regressions failed seven cases before the fix and passed after it. The final suite with real pinned rc8 references passed 309 tests in 96.700s, no skips. Linux execution and controlled Mac facts are distinct from actual Recovery compatibility or hardware acceptance. Source, table, manifest and wrapper checks do not establish network availability on the user's Mac. Full logs are retained separately rather than automatically published. The inspected pre-publication main workflow failed without a runner or steps; no CI success or real Mac validation is claimed.
