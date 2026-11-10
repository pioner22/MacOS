# Происхождение компонентов

Владелец приложения: pioner22, проект project_10, работа W-0421.
Код интерфейса, IPC, подписок, установки и обновления: GPL-3.0-or-later.

`src/vendor/legacy_runtime.py` сохранён без изменений из
`pioner22/MacOS`, commit `c5f8f7c1cd6dee534e22ca0d33b1cdb83092f0f0`,
путь `vpn/vpn-runtime.py`. SHA-256:
`966a6d63a7968113af5c713b5595c9c9c53628fb80e83badd31bedb84d24b877`.
Используются проверенный разбор VLESS/Trojan, ограниченный HTTP-клиент
и временный DNS macOS через SystemConfiguration. Его установщики и обновлялки
не вызываются. Лицензия GPL-3.0 включена в LICENSE.

Ядро: официальный sing-box 1.14.0, commit
`0b8995879f29a9b98ee027bc17b75e101445b238`, GPL-3.0.
Источник и исходный код: https://github.com/SagerNet/sing-box/tree/v1.14.0.
Intel macOS использует официальный вариант legacy-macos-10.13, Linux —
официальные amd64/arm64. Транспорт, URLTest, selector, TUN и счётчики
предоставляет ядро; клиент не заменяет их собственной реализацией.

Python на Mac: python-build-standalone, CPython 3.12.16, выпуск 20261026.
https://github.com/astral-sh/python-build-standalone/releases/tag/20261026
Установщик сохраняет поставляемые с этой средой лицензии Python и библиотек.
Linux использует системный Python 3 через штатные зависимости .deb.

Все URL, архитектуры и SHA-256 архивов закреплены в
`packaging/dependencies.tsv`. Они загружаются непосредственно от издателей
при установке. PyPI, Homebrew, произвольные install scripts и отключение
проверки TLS не используются. Контрольные суммы подтверждают целостность,
но не являются отдельной цифровой подписью издателя приложения.
