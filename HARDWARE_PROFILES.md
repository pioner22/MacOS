# Профили / Profiles — diagnostics v2

## Русский

Эта страница заменяет инструкцию профилей v1. Пункт **15** сохранён. Авторитетный исполняемый профиль находится в `diagnostics_v2/profile.sh`; старый `diagnostic_profile.sh` оставлен как исторический модуль и не используется новым загрузчиком.

Автоматически читаются `hw.model`, архитектура процесса, тип CPU с учётом Rosetta, объём RAM, версия и сборка работающей macOS. Recovery определяется консервативно по CDIS и Base System; полная ОС — по Finder и маркеру завершённой настройки. Неопределённая среда остаётся unknown. Это эвристика, а не доказательство способа загрузки.

Модель: AUTO, A2141 (`MacBookPro16,1` / `MacBookPro16,4` с Intel), Generic Intel, Apple silicon, Limited. ОС: AUTO, Catalina, Big Sur, Monterey, Ventura, Sonoma, Sequoia, Tahoe, Other. Среда: AUTO, Recovery, Full macOS, Limited. Ручной выбор не может противоречить обнаруженному оборудованию/ОС или превратить unknown в полную ОС. Название целевого установщика не является версией загруженной среды.

В версии 2.0.0-rc1 нативные RAM/CPU/файловый/Metal тесты допускаются только для поддерживаемой полной Intel macOS. На Recovery/Apple silicon/unknown они возвращают INCONCLUSIVE. Это преднамеренное ограничение до реальной проверки этих конфигураций. Сеть, self-test и наблюдения имеют собственные ограничения. Выбор модели не устанавливает ОС и не меняет права.

Старые разрушительные пункты 1/13 и SSD-точка входа заблокированы независимо от модели; ручной выбор A2141 их не разблокирует. Для нового файлового теста используется пункт 17 с отдельным согласием TEST-FILES. Приёмка — пункт 16. Отдельный 40-ГиБ bridge — пункт 18 с согласием RAM-BRIDGE.

Предыдущие 35 проверок относились к v1; они не подтверждают новую версию. Фактические v2 регрессии, границы проверки и инструкция: [QA_RESULTS](docs/diagnostics/QA_RESULTS.md), [Приёмка](docs/diagnostics/POST_REPAIR_RU.md).

## English

Option 15 remains available. The v2 profile implementation is `diagnostics_v2/profile.sh`; the old root profile library is historical and unused by the new launcher. Detection reads real model, CPU/process architecture including Rosetta, RAM and running macOS version/build. Conservative Recovery/full classification remains heuristic. Manual selection cannot elevate an unknown environment or contradict observed data.

Native RAM/CPU/file/Metal tests in this RC are limited to supported full Intel macOS. Recovery, Apple silicon and unknown configurations are not certified by merely appearing in the profile menu. Legacy raw entry points stay quarantined regardless of model. File testing and the external bridge require separate consent. See the current v2 QA and acceptance documents; the former 35 v1 checks are not a v2 result.
