# Единый выпуск / Unified release — 2.0.0-rc2

## Запуск / Launch

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

`main/st.sh` теперь читает `main/diagnostics-release.tsv` с запретом кеширования и уникальным параметром запроса. Описание выпуска читается один раз; все 11 файлов затем скачиваются по одному неизменяемому commit и проверяются по размеру/SHA-256. Никакого смешивания main и экспериментальной ветки в середине сеанса. При смене опубликованного выпуска команда пользователя не меняется. Первоначальный bootstrap и HTTPS остаются доверенной точкой входа; это не цифровая подпись. При ошибке самого внешнего curl до получения скрипта интерпретатор может не начать работу: смотрите также вывод curl.

В начале ожидается `RELEASE_VERSION=2.0.0-rc2`. Первый прогон — пункт 14, затем профиль 15 при необходимости и пункт 16 в полной Intel macOS с установленными Command Line Tools. Полный RAM требует успешного mlock; отказ прав/ресурсов не считается неисправностью RAM. Запускайте тесты с закрытыми лишними приложениями, исправным охлаждением и резервной копией.

## Согласование веток / Reconciliation

Активная архитектура — `diagnostics_v2/`, на основе main 4382067a. Из идей PR3 перенесены проверенный процессный supervisor с отдельной группой, managed Metal readback/synchronizeResource, уточнённая семантика HTTP и отчёты. Нестрогое поведение mlock из кандидата 0.3.0 не принято. Сохранены строгий native RAM, отдельный 40-GiB bridge и блокировка RAW. Результаты 71 и 79 прежних веток не складываются: единая сборка проверена заново.

## Дополнительные исправления / Additional fixes

Обработчики вызывающего скрипта больше не сбрасываются supervisor. Ctrl+C, TERM, HUP, тайм-аут, ошибки журнала не дают PASS; проверена реальная отмена через псевдотерминал. Нативный процесс сообщает прогресс каждые 256 MiB; supervisor каждые 15 секунд выводит heartbeat. Heartbeat означает живой процесс, не доказывает продвижение GPU/драйвера.

Отчёт `REPORT_RU_EN.md` и `summary.tsv` создаются в уникальном каталоге. Полная приёмка заранее сохраняет план; оставшиеся после остановки этапы обозначаются NOT_RUN. Отчёт включает версию/ревизию, модель, время, результаты, пути журналов и следующие действия. Вывод ошибок не назначает виновную микросхему. PENDING_MANUAL после чистых автоматических этапов — не неисправность, а требование независимой/ручной проверки и холодного повтора. Сохранность последних буферов при аварийном отключении не гарантирована.

Пункты 1 и 13 — BLOCKED, 16 — приёмка без стирания разделов, 17 — новый 1-GiB файл, 18 — отдельный 40-GiB RAM→внешний RESCUE с согласием. Проверка файла не охватывает весь SSD. GPU по-прежнему экспериментальный: 256 MiB на устройство, не вся VRAM. Нативные этапы Recovery этой ревизией не разрешены. Публикация сетевых fixtures остаётся отдельной задачей; отсутствие удалённого файла — INCONCLUSIVE, не дефект ноутбука.

В полной macOS журналы по умолчанию находятся в `~/Library/Logs/MacHardwareDiagnostics/macdiag-v2.*/`; можно заранее задать существующий `MACDIAG_REPORT_DIR`. В Recovery используется доступный RESCUE, иначе /tmp. Источники проверенного пакета сохраняются в /tmp для диагностики. Логи автоматически никуда не отправляются; они могут содержать идентификаторы оборудования.

Для архива: `bash st.sh --offline selftest` либо `bash st.sh --offline menu`. Доступ к сети всё равно нужен для сетевых стадий.

## Фактическая проверка / Actual validation

93 автоматические проверки прошли на Linux с Bash 5.2; в их числе меню/профили/отчёты, реальные локальные TLS/curl-передачи, малые C-выделения и инъекция дефектов, Ctrl+C в PTY, завершение группы процессов, hash/size/Range, проверка bootstrap и offline-пакета. 93 — число test methods; подпроверки маршрутизации меню проверяют все 17 исполняемых пунктов. Не было теста настоящего A2141, macOS/Recovery/Bash 3.2/Metal, 40/48-GiB нагрузки и сети пользователя. ASan/UBSan для RAM Full и file I/O на 1 MiB не обнаружили ошибок; файловый движок корректно вернул 3 на Linux из-за отсутствия Apple cache controls.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Для PTY-регрессий нужен `pexpect==4.9.0`. CI-статус читается отдельно; локальные PASS не объявляются зелёным GitHub Actions. Полные локальные логи входят в архив, приложенный в чате.

## English

One active implementation, diagnostics_v2, preserves strict mlock, the external bridge and RAW quarantine. The stable launcher resolves a cache-busted published descriptor once, then verifies one immutable package. Mode 16 is non-destructive acceptance; modes 17/18 are separately consented file/bridge checks. Version, revision and per-stage reports remove ambiguity between prior candidates. Unexecuted stages remain NOT_RUN; manual acceptance remains pending even when automated stages pass.

93 software regressions passed on Linux, including local TLS/curl, small native C tests, PTY cancellation, menu routing and report semantics. Real macOS, Metal and Mac hardware are not certified. A successful software regression is not proof of a repaired laptop. See the Russian sections above and POST_REPAIR_EN.md for the preserved engine scope.
