# BigSurVPN App — разработка

Исходники нативного приложения перенесены из `vpn-app/` в `vpn/app/`. Это не новый готовый выпуск и не обновление установленного VPN.

[Единая кнопка обновления](UNIFIED_UPDATE_RU.md) · [Инструменты выпуска](README_RU.md) · [Политика автопереключения](failover/README_RU.md) · [VPN CLI](../README.md)

Из корня репозитория:

```sh
python3 -m unittest discover -s vpn/app/tests -v
swift test --package-path vpn/app -j 2
swift test --package-path vpn/app/failover -j 2
```

Нативная тестовая сборка выполняется только на macOS с Xcode:

```sh
python3 vpn/app/tools/build_release.py build --development --output /tmp/BigSurVPN.app
```

Обновлены пути workflow и будущей ленты `vpn/app/updates/appcast.xml` во всех трёх местах: release.json, Swift-политике и Python-инструменте выпуска. Bundle ID, номера сборок, теги выпусков, проверка подписей и адреса локальной службы не изменены. Development-сборка не загружает обновления из ненастроенного канала.

Полноценное управление туннелем и сетевой адаптер failover ещё не готовы. Подробности и ограничения подтверждения на Big Sur указаны в документах выше.
