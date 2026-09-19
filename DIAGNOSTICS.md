# Диагностический комплект 0.2.0-audit

**Экспериментальная review-ревизия. Не коммерческий релиз.**

Подробный аудит и границы проверки: [русский отчёт](docs/diagnostics/AUDIT_RU.md).  
English documentation: [audit report](docs/diagnostics/AUDIT_EN.md).

В этой ветке старый destructive RAW-тест исключён из меню. Пункт 1 — тест собственного нового файла, **не** полный LBA-тест диска. Сохранённые данные и старый Pattern A автоматически не перезаписываются. RAM и дисковый round-trip больше не смешиваются.

## Локальный запуск после получения исходников

```bash
bash toolkit_selftest.sh
bash ram_quick_test.sh
```

Для независимого C-движка нужен рабочий компилятор. В Recovery без компилятора доступен явно обозначенный Perl-screening. Он не позволяет определить физический DRAM-чип.

```bash
MACDIAG_RAM_ENGINE=native MACDIAG_RAM_MIB=1024 bash ram_quick_test.sh
```

Полный RAM-тест требует ввода `BURNIN`. Он имеет лимит времени движка; при занятости ОС возможны ограничения выделения памяти. Такой выход не означает повреждённую DRAM.

```bash
bash ram_full_test.sh
```

Тест файла требует существующего каталога и ввода `FILETEST`. На исходных пользовательских файлах он не выполняется:

```bash
MACDIAG_TARGET_DIR=/Volumes/RESCUE MACDIAG_STORAGE_MIB=256 bash ssd_test.sh
```

`RESCUE` в примере — явно выбранный пользователем каталог, не автоматически признанный внешний накопитель. В Recovery без компилятора file-test вернёт INCONCLUSIVE; готовые подписанные бинарники пока не выпущены.

## Сеть

```bash
bash network_test.sh
MACDIAG_DOWNLOAD_MAX_MIB=32 bash download_test.sh
MACDIAG_DOWNLOAD_MAX_MIB=512 bash download_test.sh
```

Размеры: 1, 8, 32, 128, 512 MiB. По умолчанию профиль до 32 MiB. Полный профиль включает проверку диапазона 16 MiB. Собственные GitHub Release-файлы должны быть предварительно опубликованы; недоступность эталона — INCONCLUSIVE. Автоматического незаметного fallback на другой набор нет. Внутри hash-потока нет curl retry.

## Комплекс

```bash
bash full_safe_suite.sh
bash full_all_suite.sh
```

Расширенный комплекс добавляет полную RAM; ни один комплекс не запускает старую RAW-перезапись. После неуспешной RAM-проверки зависимые проверки останавливаются. Наблюдения питания/экрана не сертифицируют эти устройства.

Логи: путь `LOG=...` печатается в консоль; по умолчанию приватные каталоги `/tmp/macdiag-run.*`. `/tmp` и swap в полноценной macOS могут использовать внутренний диск. Нет обещания сохранности последних строк после внезапного отключения питания; логи не загружаются в сеть автоматически.

## Проверка кода

```bash
python3 -m unittest discover -s tests/diagnostics -v
python3 tools/build_diag_manifest.py
```

См. [состояния результата](RESULT_STATES_RU_EN.md) и [фактический протокол проверки](docs/diagnostics/QA_RESULTS.md).
