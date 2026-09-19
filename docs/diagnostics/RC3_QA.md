# Проверка rc3 / rc3 validation

Версия: 2.0.0-rc3. Итоговый повтор для опубликованных исходников: **124 tests in 55.212s, OK**. 124 — один набор, не сумма независимых веток. Из них 31 новый тест профилей Recovery, ограниченных сценариев и экспорта обратной связи.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Среда: Linux, Bash 5.2, Python 3.13, pexpect 4.9.0, Perl, curl, cc. Выполнялись реальные малые C/Perl RAM/file проверки, локальный TLS-сервер и управляемые ошибки; сведения Mac и загрузка пакета в интеграционных тестах имитировались.

Проверены: Recovery без компилятора/Perl, full macOS с toolchain, Rosetta, Apple silicon как ограниченный профиль, safe mode, неоднозначная среда, версии ОС, bounded probe, бюджет памяти, сохранение профиля до меню, отсутствие неявной записи в home Recovery, чистый screen без полного PASS, инъекция порчи RAM/файла, сохранность контрольного пользовательского файла, остановка на mismatch, отсутствие SSD write/extended RAM в safe suite, reviewed-export без serial/IP/path/token и отказ symlink-источника. Сохранены предшествующие сетевые/native/menu/report/PTY-регрессии.

В полном логе сохранены предупреждения Python 3.13 forkpty в многопоточном тестовом процессе; прогон закончился OK. Их нельзя выдавать за отсутствие вообще любых предупреждений.

**Не проверено:** реальный Mac/Recovery/Bash 3.2, Metal, все модели и версии ОС, загрузка готового native-бинарника в Recovery, 40/48 ГиБ нагрузки, аппаратное отключение питания. Нативные prebuilt binaries и сервер сбора отчётов этим выпуском не поставляются. CI-проверка оценивается отдельно; локальный OK не означает GitHub Actions PASS.

Лог сжат без изменения содержимого: [qa-rc3-linux.log.gz](qa-rc3-linux.log.gz). SHA-256 распакованного лога: `10674792500ca33f1e16d349bba1f1bba247a6a57d28b34761e55a2c62a9752a`.

Пакет исходников: `e2c9c63b236e9b0f6d254810d8d5dd7b20185553`. Bootstrap: `069c6d7feafa8eff75696d38b0818eb43fbe9ec5`. Манифест SHA-256: `2fe7ff40614082b5e1b76f26275cb0cd019cc6f68792f1fbeb20ed02fa028061`.

## English

One final suite passed 124 tests in 55.212 seconds. Linux software validation only: real small native/Perl operations and local TLS with simulated Mac probes. No real Recovery/Metal or large memory load is certified. Clean limited screening stays INCONCLUSIVE. Review the preserved forkpty warnings in the compressed log. The source/bootstrap references and uncompressed log digest identify this run.
