# Профили оборудования и среды — rc3

Основной реестр: `diagnostics_v2/profiles.tsv`; выбор и пробы: `diagnostics_v2/profile.sh`. Девять шаблонов A2141/Intel/Apple Recovery/full, safe, ambiguous installer/recovery и unknown дополняются версией ОС, архитектурой процесса и типом консоли. Это составной профиль, а не сотни копий одного shell-скрипта.

Порядок: minimal preflight → hardware/OS/environment → фактически работающие инструменты → backend policy → журнал профиля → меню. Присутствующая команда и успешно проверенная команда имеют разные состояния. Пробы ограничены временем. Root UID не равен Recovery; x86_64 процесса не равен Intel CPU при Rosetta; ОС установщика не равна загруженной ОС.

В Recovery без toolchain выбирается ограниченный Perl screen, если его зависимости работают. Без них тест помечается недоступным. Native сохраняет обязательный mlock и бюджет памяти. Неизвестная среда не получает право на большую нагрузку. Ручной профиль может ограничить запуск, но не подменить факты. Все профили пока SOFTWARE_TESTED_REAL_HARDWARE_PENDING.

Пункт 15 меняет подтверждённый профиль, не устанавливает ОС. RAW-пункты 1/13 заблокированы для любой модели. Файловая запись требует отдельного согласия. Пункт 19 сохраняет локальный минимальный экспорт без автоматической отправки.

[Подробная архитектура RU](docs/diagnostics/RECOVERY_PRODUCT_RU.md) · [English](docs/diagnostics/RECOVERY_PRODUCT_EN.md) · [QA rc3](docs/diagnostics/RC3_QA.md)

Historical rc1/rc2 documents describe their own revisions. The current profiles are software-tested scenarios, not proof that every listed Mac/Recovery version has been exercised on real hardware.
