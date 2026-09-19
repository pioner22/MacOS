# Профили MacDiag 0.3 / Model and running-OS profiles

Пункт 15 сохраняется. По умолчанию AUTO. Модель, CPU/архитектура, RAM и версия/сборка работающей macOS определяются заново. Выбор описывает загруженную ОС, а НЕ устанавливает её. A2141 распознаётся по MacBookPro16,1/16,4; x86_64 под Rosetta не считается Intel CPU.

Option 15 remains available, AUTO by default. Profiles describe the running environment, not an installation target. Rosetta process architecture is not proof of Intel hardware.

Ручной выбор, противоречащий фактам, отклоняется. Recovery/полная macOS определяются консервативной эвристикой. Unknown или ручное утверждение не повышает права режима. Intel с полной macOS допускается к проверке предпосылок нативных тестов; Apple silicon/неизвестная платформа — только ограниченные наблюдения/сеть. Это не заявление о проверке всех моделей и версий ОС.

Manual choices cannot override contradictory detection. Recovery/full detection is heuristic. Unknown/manual claims do not elevate permissions. Native tests target eligible full Intel macOS; Apple silicon has limited observation/network support, not validated native stress coverage.

Распознаются Catalina, Big Sur, Monterey, Ventura, Sonoma, Sequoia, Tahoe; Other ограничивает стресс-тесты. Наличие компилятора проверяется реальной сборкой, а не только существованием clang-stub.

Catalina through Tahoe are recognized as profile labels; Other restricts stress tests. Actual compilation, not merely a clang path, validates build prerequisites.

Изменение относительно старой версии: активный SSD-тест теперь файловый, без стирания. Пункты 13 и 16 — недеструктивная приёмка с явным согласием на создание собственного файла. Старая политика ERASE-INTERNAL-SSD и legacy RAW части не используются новыми точками входа.

Unlike the earlier version, active SSD testing is allocated-file only. Options 13 and 16 run non-destructive acceptance with explicit file-creation consent; legacy RAW erase routines are not called.

Исходники: diagnostics/v2/profile.sh, menu.sh, run.sh. Фактическая новая валидация и ограничения: docs/diagnostics/QA_RESULTS_0_3.md. Прежние 35 проверок старого профиля не являются сертификацией новых движков.
