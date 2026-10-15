# External review follow-up — bootstrap 1.1 / диагностика 2.0.0-rc3

## Оценка замечаний

Исходный main: `5c68b65dc5e3b59040abf92e61d715a11394f39f`. Замечания независимого ИИ проверены по коду и воспроизведены, а не приняты автоматически.

1. Подтверждено: некорректное многострочное описание выпуска завершало st.sh кодом 3 с пустым stderr. Теперь проверки bootstrap выводят BOOTSTRAP_REASON и RU/EN объяснение; события и исходный stderr curl сохраняются в bootstrap.log.
2. Подтверждено: одиночный временный сбой получения release descriptor или manifest прекращал запуск. Теперь описание, манифест и файлы используют общий bootstrap-only fetch: до трёх попыток, свежий временный файл, окончательный HTTP 200, раздельные HTTP/curl коды. Повтор разрешён только для выбранных временных сетевых ошибок и HTTP 408/429/500/502/503/504. HTTP 404, ошибки записи и проверки сертификата автоматически не повторяются.
3. Уточнено: curl 60 не доказывает ошибку часов. Печатается UTC с предложением проверить время, доверенные CA, цепочку сертификатов и сеть. Нет -k, перехода на HTTP, автоматической смены даты или доверия сертификатам.
4. Уже реализовано в rc3: профиль выбирает Perl-скрининг / native / unavailable. Отсутствие clang не является аппаратным FAIL. Исходники C/Objective-C остаются в проверяемом манифесте; это не требует компиляции в каждой среде.
5. Уточнено: /dev/tty должен действительно открываться. Существование пути и перенаправление stdin сами по себе не гарантируют controlling terminal. Проверка открытия сохранена.
6. Дополнительно учтено: curl до 8.4 мог не ограничивать неизвестный заранее размер через --max-filesize. Добавлен дочерний ulimit -f без изменения лимита вызывающего процесса и независимая проверка принятого размера. Временный потолок консервативен и округлён, примерно до двух заданных лимитов; это не byte-exact streaming cap. Непроверенный файл не исполняется.
7. В workflow добавлены явные bash -n и ShellCheck для st.sh. ShellCheck локально недоступен; успешный его прогон и GitHub CI не заявляются. Настройки защиты ветки не менялись.

## Область изменения

Постоянная команда main/st.sh прежняя. Новая строка: BOOTSTRAP_VERSION=1.1. Диагностический пакет не изменён: RELEASE_VERSION=2.0.0-rc3, payload e2c9c63b236e9b0f6d254810d8d5dd7b20185553. RAM/SSD/сетевые тесты, профили, согласия и RAW quarantine не переписывались. Новый fetch не применяется к диагностическому потоку curl→SHA. Совместимые точки входа закреплены на bootstrap commit 9fb895ad6142e60c10f93f5077345e5c84b899f6.

## Фактическая проверка

Два новых сценария сначала были выполнены против старого st.sh: воспроизведены молчаливый отказ и отсутствие повтора metadata. Завершившийся итоговый прогон изменённой версии: **140 tests in 141.260s, OK** (124 прежних + 16 новых test methods).

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Новые сценарии: transient retry для descriptor/manifest/source, свежий partial, исчерпание попыток, HTTP 503/404, TLS 60, локальная ошибка записи, stderr/журнал, malformed descriptor, hash mismatch без повторов, верификация C-исходника, excessive size/OS file limit, фиксация ревизии после resolution, headless selftest. Bootstrap HTTP имитируется контролируемыми ответами. Прежние локальные TLS и малые нативные проверки выполнялись в том же наборе.

Среда: Linux x86_64, Bash 5.2, Python 3.13.5. Полный неизменённый лог приложен к ответу в чате; его SHA-256: `2e558fa0b540ac03f23083e5864b7644f7d974796b017d5e26fd0a42ba31b2a6`. Предупреждения тестовой среды не удалялись. Ранние синхронные попытки общего прогона были прерваны лимитом среды выполнения инструментов и не засчитываются как PASS; число 140 относится к завершившемуся повтору.

Это не проверка Mac/Recovery, старого curl на Mac, ShellCheck или физической RAM. Проверки модификаций загрузчика не добавляют оснований для аппаратного диагноза. Дополнительная настройка CI не означает, что runner уже запустил команды.

## English

Two findings were reproduced: silent descriptor rejection and missing metadata retries. Bootstrap 1.1 adds explicit bilingual failures and bounded fresh-file retries without changing the rc3 diagnostic payload or permanent command. TLS 60 remains a certificate-validation failure, not proof of a clock fault. Compiler absence already selects limited/unavailable backends. All manifest sources still undergo integrity validation. Child-only file-size limits protect old curl paths; exact accepted length remains independently checked.

140 local software tests passed. No real macOS/Recovery, ShellCheck execution, GitHub CI success or hardware-health claim. ShellCheck is configured as a future CI gate. The unchanged test log and its digest identify the actual completed run.

## Primary references

- https://curl.se/libcurl/c/libcurl-errors.html
- https://curl.se/docs/faq.html
- https://curl.se/docs/manpage.html#--max-filesize
- https://www.gnu.org/software/bash/manual/html_node/Redirections.html
- https://github.com/koalaman/shellcheck
