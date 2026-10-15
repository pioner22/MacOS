# Диагностика Mac

Все диагностические материалы перенесены сюда с сохранением внутренней структуры и содержимого исходников.

- `diagnostics_v2/` — основной Recovery-first комплекс и манифест пакета.
- `macdiag_core/` — отдельный сборщик паспорта среды.
- `registry/`, `diagnostic_profile.sh` — профили устройств и возможностей среды.
- `tests/`, `tools/` — программные проверки и генераторы.
- `docs/`, `DIAGNOSTICS.md`, `MACDIAG_CORE_RU.md`, `HARDWARE_PROFILES.md` — документация.
- Остальные сценарии и `mhdd_v2.part*` — сохранённые прежние материалы; не собирайте legacy-комплекс вручную и не снимайте запреты разрушительных режимов.

## Запуск

Постоянная ссылка: `curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash`.
Только паспорт среды: `curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/macdiag-core.sh | bash`.
Из клона для автономного запуска: `bash diagnostics/st.sh --offline` из корня репозитория.

## Проверки из этой папки

```sh
python3 -m unittest discover -s tests/diagnostics_v2 -v
python3 -m unittest discover -s tests -p 'test_*profile*.py' -v
python3 tools/build_diagnostics_v2_manifest.py
```

Прежние внутренние относительные пути оставлены намеренно. Исторические ссылки на закреплённые коммиты остаются рабочими. Генерация манифеста изменяет локальный файл: проверяйте diff перед публикацией.
Исторические документы могут описывать запуск из прежнего корня; теперь их рабочий каталог — `diagnostics/`.

[Основная документация](DIAGNOSTICS.md) · [Паспорт среды](MACDIAG_CORE_RU.md) · [В начало](../README.md)
