# Профили модели и ОС

## Использование

Постоянная команда не изменилась:

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

В меню добавлен пункт **15 — MODEL / OS PROFILE**. При каждом открытии меню автоматически показываются модель, тип CPU, архитектура процесса, объём RAM, версия и сборка работающей macOS, предполагаемый режим Recovery/полная macOS и доступность основных инструментов. Автоопределение — режим по умолчанию; пункт 15 позволяет изменить профиль текущего запуска.

Выбор профиля не запускает стресс-тест, не форматирует накопитель и не устанавливает ОС. Для следующей загрузки снова используется автоопределение. Номера прежних пунктов 1–14 сохранены.

## Модель

| Выбор | Назначение |
|---|---|
| AUTO | Профиль по фактическим данным системы |
| A2141 | MacBook Pro 16-inch 2019, идентификаторы MacBookPro16,1 и MacBookPro16,4; требуется обнаруженный Intel |
| Generic Intel | Другие Intel Mac; разрушительный SSD-движок недоступен |
| Apple silicon | Ограниченный профиль: сведения об оборудовании, питании, сеть и скачивание; RAM/GPU/SSD-комплекс этой версии не объявлен проверенным на Apple silicon |
| Limited | Сбор сведений, сеть, скачивание и self-test без аппаратных стресс-тестов |

Архитектура процесса x86_64 сама по себе не доказывает Intel: учитываются hw.optional.arm64 и sysctl.proc_translated. Ручной выбор A2141 при несовпадающем идентификаторе или типе CPU отклоняется. Это защита от ошибочного выбора, а не от злонамеренной подмены системных команд привилегированным пользователем.

## ОС и режим

Выбирается **загруженная среда**, а не версия установщика и не ОС на другом томе:

- AUTO;
- Catalina 10.15;
- Big Sur 11;
- Monterey 12;
- Ventura 13;
- Sonoma 14;
- Sequoia 15;
- Tahoe 26;
- Other / ограниченный режим.

Отдельный выбор: AUTO, Recovery, Full macOS или Limited. Например, при работающей Catalina Recovery нельзя выбрать Tahoe и получить инструменты Tahoe. Несовпадение возвращает INCONCLUSIVE / OS_VERSION_MISMATCH, а не аппаратный FAIL.

Определение Recovery намеренно консервативное: нужны одновременно каталог CDIS и признак Base System в сведениях о корневом томе. Полная macOS предполагается по Finder и маркеру завершённой настройки, при отсутствии CDIS. В остальных случаях режим остаётся unknown. Это эвристика, требующая проверки на реальных версиях Recovery; ручное указание Recovery при unknown не разблокирует разрушительный тест. По этим признакам не различаются Internet Recovery и локальная Recovery.

## Ограничения запусков

Разрушительный SSD-режим допускается к следующим проверкам только при обнаруженном A2141 + Intel + Recovery и согласованном профиле. Сам SSD-движок затем отдельно проверяет накопитель и размер. Его прежнее ограничение около 0,8–1,3 ТБ сохранено: название HDD/SSD не означает поддержку любого HDD, внешнего диска или всех ёмкостей A2141.

`ssd_test.sh` заново определяет модель/среду даже при прямом запуске, без меню, и требует ввода **ERASE-INTERNAL-SSD**. Пустой ввод, отказ, отсутствие интерактивного терминала и EOF ничего не разрешают. Не вводите подтверждение для проверки только профиля. Старые части `mhdd_v2.part*` — внутренние детали, не самостоятельные безопасные точки входа.

В полной macOS и на универсальных профилях для комплекса используется пункт 12. Пункт 13 включает разрушительный SSD и потому ограничен его профилем. Проверки RAM, CPU, подтверждение стирания и остальные ограничения комплекса не заменяются выбором модели.

Для Metal показывается `prerequisites_present`, только если обнаружены полная macOS, Intel, Metal.framework и установленный набор инструментов clang через xcode-select/xcrun. Это не результат теста GPU; реальная сборка и работа Metal остаются задачей gpu_test.sh. В Recovery отсутствие компилятора не трактуется как дефект видеопамяти.

## Состояния

| Состояние | Значение / действие |
|---|---|
| MODEL_ID_MISMATCH / MODEL_CPU_MISMATCH | Выбранная модель не совпадает с обнаруженной; вернуться к AUTO |
| OS_VERSION_MISMATCH | Выбрана другая загруженная версия macOS; не путать её с целевым установщиком |
| ENVIRONMENT_MISMATCH | Recovery/полная macOS не совпадают; проверить фактический режим |
| STORAGE_PROFILE_NOT_APPROVED | Разрушительный SSD-тест не разрешён этим профилем; не обходить ограничение |
| PERL_NOT_AVAILABLE / SHA_TOOL_NOT_AVAILABLE | Недоступен инструмент; это ограничение среды, а не поломка RAM/CPU |
| TEST_NOT_VALIDATED_FOR_PROFILE | Этот стресс-тест не заявлен для выбранного профиля |
| NO_INTERACTIVE_INPUT | Нет доступного интерактивного ввода; требуется Terminal |
| CANCELLED no_erase_consent | Согласие на разрушительный тест не получено; тест не стартует |

Сообщения содержат отдельные строки RU и EN. Код 3 означает ограничение/неполный результат, а не аппаратную неисправность. Сводка профиля записывается в небольшой журнал сеанса `/tmp/macdiag-menu.*/session.log`; после перезагрузки Recovery он может исчезнуть. Действующие тесты отдельно сохраняют свои журналы по прежним правилам. `/tmp` в обычной macOS может находиться на внутреннем SSD: обещание полного отсутствия любых записей здесь не даётся.

## Что действительно проверено

Для этого изменения локально выполнены **35 автоматических тестов**: 26 тестов политики и определения профиля плюс 9 тестов меню и отказов SSD-точки входа. Среда: Linux, GNU Bash 5.2.37, Python unittest. Системные команды и загрузка зависимости заменены контролируемыми ответами. Проверены, в частности, A2141, второй идентификатор 16,4, Rosetta, несовпадение версии ОС, unknown, отказ без подтверждения и запрет SSD из полной macOS. Для трёх изменённых/новых shell-файлов также выполнен `bash -n`.

```bash
python3 -m unittest discover -s tests -v
```

Это **не** аппаратный PASS ноутбука, не полный аудит старых диагностических движков и не реальный прогон под macOS/Recovery. Код использует конструкции Bash 3.2, но в этом прогоне реального интерпретатора Bash 3.2 и Mac не было. Первая проверка на целевой машине — открыть меню, посмотреть профиль, при необходимости выбрать пункт 15 и завершить пунктом 0, без стресс-тестов.

Исходники: `diagnostic_profile.sh`, `current.sh`, `ssd_test.sh`. Регрессии: `tests/test_diagnostic_profile.py`, `tests/test_profile_entrypoints.py`. Версия profile-library закреплена в точках входа по commit, чтобы она не менялась посреди сеанса; это не подпись и не гарантия подлинности всего комплекта.

Официальные справочные материалы: [идентификаторы MacBook Pro](https://support.apple.com/108052), [Rosetta и sysctl.proc_translated](https://developer.apple.com/documentation/apple-silicon/about-the-rosetta-translation-environment).

---

# Model and running-OS profiles

Option **15 — MODEL / OS PROFILE** was added to the existing menu. Automatic detection remains the default. Model, CPU family, process architecture, RAM size, running macOS version/build, conservative Recovery/full-environment classification and tool availability are displayed before test selection.

Profiles: AUTO; A2141 (MacBookPro16,1 / MacBookPro16,4, Intel required); Generic Intel (no destructive SSD); Apple silicon limited observations/network; Limited. OS selections cover Catalina, Big Sur, Monterey, Ventura, Sonoma, Sequoia, Tahoe and Other. These are recognition/policy profiles, not a claim that every test is validated on every listed OS.

The selection describes the **running environment**, not an installer or another mounted OS. Manual choices cannot override contradictory detected hardware/version data. Unknown environment cannot be manually promoted into destructive eligibility. Recovery detection is heuristic and does not identify Internet versus local Recovery.

The standalone SSD entry point re-detects the real environment and requires explicit `ERASE-INTERNAL-SSD` input. Its legacy internal-Apple-SSD size/device checks still apply; no arbitrary HDD, external disk, capacity or Apple-silicon support is added. Option 12 is the non-destructive suite; option 13 inherits the destructive SSD profile restriction. Selecting a profile never starts a test or installs an OS.

`INCONCLUSIVE` profile failures are not hardware diagnoses. GPU prerequisite discovery is not GPU PASS. Some observational tests are available on limited profiles; this does not certify their platform-specific completeness.

Actual validation for this change: 35 mocked automated tests passed on Linux with Bash 5.2.37, plus shell syntax checks. No real macOS/Recovery/Bash 3.2 execution, GPU test, SSD write or Mac hardware certification was performed. This change does not re-audit or validate the older RAM/SSD/GPU engines. Use the menu/profile display and exit first when checking it on a real Mac.
