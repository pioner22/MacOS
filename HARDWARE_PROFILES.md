# Профили и совместимость / Profiles and compatibility — rc8

Активный runtime: diagnostics_v2/profile.sh + registry.sh и четыре registry_*.tsv. Авторский источник: registry/diagnostics.json; генерация: tools/build_diagnostics_registry.py. Старый profiles.tsv сохранён для изолированных legacy-unit сценариев, не является основным правилом нового публичного запуска.

Профиль учитывает фактические CPU/process architecture/Rosetta, Model Identifier, ОС/build, Recovery/full/safe/unknown, текущий и системный Bash, права/консоль и необходимые возможности инструментов. Ручной выбор может ограничить, но не подменить наблюдения. Год устройства — документальный справочник, а не способ определения Bash. Равный приоритет подходящих правил приводит к ограничению, не произвольному выбору.

В этом выпуске 13 документальных строк для 11 идентификаторов, 9 шаблонов, 12 capability-контрактов. Статус всех аппаратных сочетаний: реальные испытания впереди. Присутствие записи не означает испытание этой модели/ОС. Компилятор CANDIDATE ещё должен успешно собрать конкретный движок; READY — только предварительная готовность. Объём памяти, mlock, целевой диск и согласие не отменяются реестром.

Пункт 21 или локально `bash st.sh --offline profile` создаёт паспорт/план и OBSERVED/5. Пункт 15 возвращает к меню. Файлы плана сохраняются до меню и после изменений профиля, в финальном отчёте отделены от результатов тестов. Полные журналы приватны; автоматической отправки нет.

Отдельный macdiag_core и его CLI не изменены. Устройства импортированы из зафиксированного catalog.json как данные, без обязательного JSON-парсера на Recovery. Данные реестра сохраняют ревизию 2026-09-20.1. Подробности: [RU](docs/diagnostics/RC7_REGISTRY_RU.md), [EN](docs/diagnostics/RC7_REGISTRY_EN.md), [QA rc8](docs/diagnostics/RC8_QA.md).

English: The active diagnostic launcher now uses declarative compatibility rules and live capability probes. The separate core CLI is not replaced. Documentary device references, software-tested profiles, executed probes and actual hardware validation are different evidence levels. No automatic load, repair or upload follows from a profile match. See the linked release documentation.
