# Исправления независимого ревью — 2.0.0-rc4 / Bootstrap 1.2

## Статус и запуск

Это проверенный программными регрессиями кандидат, не сертификат исправности Mac.
Постоянная команда:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Ожидаются BOOTSTRAP_VERSION=1.2 и RELEASE_VERSION=2.0.0-rc4. Порядок сохранён: проверка пакета → определение оборудования/работающей ОС/инструментов → профиль → меню. Начните с пункта 14. Recovery без компилятора использует только ограниченные доступные сценарии; готовые проверенные Mac-бинарники этим выпуском не добавлены.

## Изменения результата и безопасности

**Прерывание.** Начатый этап регистрируется до конвейера. EXIT-finalizer восстанавливает запись о прерванном этапе, если основной обработчик не успел её записать. Он не становится NOT_RUN. tee игнорирует SIGINT, обработчики вызывающего кода не заменяются. Предложенный внешний trap ':' не использован: он терял TERM, адресованный только основному shell. Уже записанный структурированный FAIL сохраняется. Результат FAIL и Execution=INTERRUPTED могут присутствовать одновременно; код 130/143/129 сохраняет факт сигнала. Это не гарантия мгновенной остановки при зависании ядра/драйвера или блокирующем I/O.

**RAM.** coverage.tsv хранит planned_mib, budget_mib, completed_mib, installed_mib и статус. Первоначальный план зависит от режима и установленной памяти; доступный бюджет может его уменьшить, но любое уменьшение даёт INCONCLUSIVE/RAM_COVERAGE_REDUCED даже при чистом завершении. Не введён произвольный порог «половина плана». completed_mib — полностью завершённый набор шаблонов; ноль при прерывании не отрицает частичной работы. Большая нагрузка по-прежнему требует mlock. Дополнительно исправлено принятие частичного вывода неуспешного vm_stat: теперь проверяется код пробы до разбора. MAP без native больше не маскируется обычным Perl Quick.

**Сеть.** DNS, TLS, тайм-ауты и HTTP 4xx/5xx дают INCONCLUSIVE, а не общий FAIL приёмки. Для выбранных временных ошибок — максимум две независимые попытки, с новым потоком и хэшем. Восстановившаяся передача не становится чистым PASS. Несовпадение хэша, размера или диапазона остаётся FAIL проверяемого пути, без автоматического диагноза SSD/RAM. Критерий сетевого статуса намеренно изменён относительно rc3.

**Накопитель.** Путь канонизируется до проверки /Volumes; обход через .. и ссылки наружу закрыт. В Recovery требуется подтверждённый diskutil Mount Point, а не только имя каталога. В журнале сохраняются канонический путь, diskutil и df. C и Perl различают EIO/доступный EDEVERR от ресурсных ошибок, сохраняя исходный errno. Проверяются результаты pread/pwrite/fsync в тестовой инъекции. Оставшийся файл указывается только по конкретному TEST_FILE из журнала данного движка; нет поиска/удаления по общей маске. Если процесс погиб до записи имени, обнаружение остатка не гарантируется. Для файловых стадий grace увеличен до 30 с; после запроса завершения supervisor предусматривает ограниченное ожидание и CHILD_STILL_RUNNING. Принудительная остановка не гарантирует завершение ядром операции или сохранность всех буферов.

**Сборка и GPU.** В пользовательской среде предупреждения компилятора сохраняются, но не превращаются автоматически в ошибку из-за -Werror. Строгая тестовая C-сборка сохраняет -Werror, включая Fortify. Ошибка сборки не скрывается молчаливым переходом на слабый тест. Любая незавершённая Metal command buffer теперь INCONCLUSIVE; только обнаруженное несовпадение прочитанных данных сохраняет FAIL. Реальная Metal-сборка/исполнение в этой среде не проверены.

**Загрузчик.** Всё тело заключено в составную группу: проверенные усечённые хвосты до её закрытия не запускают код и не дают тихий exit 0. Пустой вход внешнего curl по-прежнему невозможно диагностировать кодом, который вообще не загрузился. Descriptor принимает ровно три непустых TAB-поля и один LF без хвоста. Контроль SHA/размеров и один immutable payload сохранены. Подпись независимого доверенного выпуска и защита от отката не реализованы. На Darwin используются системные каталоги PATH; это не замена проверке бинарников и не заявление о безопасности любых внешних сред.

**Отчёт и поддержка.** NOT_RUN сохраняется и в summary.tsv. Самопроверка явно подписана «только ПО, железо не проверялось». Исходные сведения сохраняются как profile.initial.txt/environment.initial.tsv, затем отдельно актуальный профиль. Отказ записи фиксируется как этап. SUPPORT по Enter предлагает предыдущий непустой сеанс из того же каталога, а не новый пустой. Пустой экспорт отклоняется. Уточнены действия для INCONCLUSIVE/PASS; полные локальные логи не рекомендуется публиковать. CLOCK_TRUST=UNVERIFIED явно отделяет часы ОС от проверенной временной метки. Убраны глобальные sync без ограничения времени из учёта стадий; журнал не является power-loss-safe хранилищем.

## Сохранённые ограничения

RAW-пункты 1/13 заблокированы; новый файловый тест не покрывает весь SSD. Отдельный 40-GiB bridge сохраняет явное согласие, внешний том и обязательный mlock. Perl RAM — до 256 MiB Quick / 1 GiB Extended, всегда ограниченный скрининг, не аппаратный PASS. Нативный максимум 48 GiB и Metal 256 MiB/device не равны проверке всех физических ячеек. Идентификация Recovery остаётся консервативной эвристикой: новые неподтверждённые признаки не включались. Настоящие Recovery/Bash 3.2/Apple clang/Metal и большие нагрузки не валидированы. Сервис автоматической отправки логов, подписи и native prebuilt-пакет не развёрнуты. Публичные сетевые fixtures требуют отдельной публикации.

Отдельные слабые места не объявлены полностью решёнными: все варианты жёсткого выключения, D-state, блокирующая запись самого журнала, доверенное время/подпись отчёта, точная чувствительность к неисправностям DRAM. Не следует использовать этот самописный комплект как единственный критерий повторной перепайки.

## Фактическая проверка

Итоговый повтор после фиксации payload/bootstrap references: 177 tests in 66.388s, OK, без пропусков. 140 сохранённых + 37 новых методов, один набор. Среда Linux, Bash 5.2.37, Python 3.13.5, GCC 14.2, Perl, локальный TLS/curl и PTY. Настоящие небольшие C/Perl проверки и fault injection; сведения Mac/бюджет 96 MiB/загрузка GitHub в тестах имитируются. Metal проверен только статическими контрактами исходника. Дополнительно 15 native-регрессий прошли под UID 0 Linux; это не тест привилегий macOS Recovery и не универсальная гарантия root/mlock.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Для тестов нужны cc, Perl, curl, openssl, Python и pexpect 4.9.0. Некоторые проверки используют Linux-пути/право создания /Volumes в тестовой песочнице. Прогоны, прерванные тайм-аутом инструмента или посторонним Python artifact_tool warmup, не учитываются как успешные. Финальный прогон выполнен отдельным системным Python. Предупреждения forkpty сохранены. ShellCheck здесь отсутствует; CI и реальная macOS оцениваются отдельно.

Лог: qa-rc4-linux.log.gz. SHA-256 распакованного журнала: 96bf013bb4d450cc275de4df4d6994c50659e9b4f436678ffd85dc63125bb95e.
Payload: e184ef4f2651fccd314401768546dd0672301dc3.
Bootstrap: 9fcc84f97a8c842fd3f885cd8523aba34905540d.
Manifest SHA-256: 20373bb5920f0148e75071434a1dad360b34d01787d2a5c63bfad0124dc7fb3f.

## English

rc4 addresses the verified review findings without treating software-test success as hardware certification. Interrupted started stages are recovered in the report; previous structured failure and execution interruption are separate. Any reduction below the original RAM plan is INCONCLUSIVE, with explicit planned/budget/completed/installed coverage. DNS/TLS/HTTP availability failures no longer cause an acceptance FAIL; data-integrity mismatches still do, without component attribution. Canonical targets and recorded mount evidence precede Recovery writes. Exact leftover engine files are reported without wildcard removal. Strict descriptor parsing, outer-group bootstrap parsing, timer cleanup, warnings-aware runtime compilation, conservative Metal errors and reviewed support selection are included.

The final pinned-reference suite passed 177 tests in 66.388 seconds on Linux, no skips; real local TLS/PTYS and small native/Perl executions coexist with explicitly mocked Mac probes. Real macOS/Recovery/Bash 3.2, Metal execution, large allocations, kernel hangs, reliable power-loss logging and repair acceptance remain unvalidated. Missing capabilities stay incomplete. RAW remains quarantined and the external bridge remains separately consented. No automatic upload, signatures, verified prebuilt Recovery binaries or protection-setting changes are supplied by this release. Earlier docs are historical where they contradict this release note.
