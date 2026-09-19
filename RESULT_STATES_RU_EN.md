# Состояния MacDiag 0.3 / Result states

| Код | State | RU | EN |
|---|---|---|---|
| 0 | PASS | Объявленный объём конкретного теста завершён без найденной ошибки | Declared scope of a particular test completed without detected error |
| 2 | FAIL | Обнаружена ошибка данных/передачи/I/O; компонент не установлен автоматически | Data/transfer/I/O failure observed; component attribution is unconfirmed |
| 3 | INCONCLUSIVE | Нет достаточных условий или проверка не завершена | Prerequisites or coverage incomplete |
| 5 | OBSERVATION | Собраны сведения, это не аппаратный PASS | Information collected, not hardware PASS |
| 130 | CANCELLED | Отмена/сигнал, завершение не подтверждено | Cancelled/interrupted; completion not established |

Код 124 supervisor — timeout; движок не считается успешно завершённым. Необычный exit или сигнал без completion marker не даёт PASS. Потеря записи журнала не допускает итоговый PASS. Ошибка раннего повтора остаётся ошибкой даже после последующего успеха.

Supervisor code 124 is timeout. Missing completion markers, abnormal exits and log-write failures cannot produce PASS. A failed transfer attempt is not erased by a later successful attempt.

## Действия / Next action

- RAM_DATA_MISMATCH: сохранить expected/actual/XOR и проверить независимым инструментом. Это не номер физического чипа. / Preserve evidence and confirm independently; not a physical-chip address.
- FILE_IO_OR_DATA_ERROR: проверить каталог/том, место, ОС, RAM и соединение. Файл-свидетельство оставлен, чужие файлы не удаляются. / Review filesystem, RAM and connection; the new evidence file may remain.
- GPU_BUILD / GPU_RUNTIME: компиляция, драйвер, timeout и ресурсы; не делать вывод «VRAM умерла» по одному такому статусу. / Build, driver, timeout and resource issues are not a VRAM diagnosis.
- HTTPS_PATH / DOWNLOAD_OBSERVATION: отдельное наблюдение сети/потока, сравнить другую сеть и проверить целостность независимо. / Compare networks and validate integrity independently.
- PROFILE_OR_ENVIRONMENT / NATIVE_RAM_UNAVAILABLE: нужна подходящая полная macOS Intel и инструментарий; ограниченная Recovery не проходит нативную приёмку. / Eligible full Intel macOS/toolchain required.
- AUTO_PASSED_MANUAL_REVIEW_REQUIRED: автоматические стадии пройдены, ручная приёмка ещё не завершена. Это НЕ FAIL ремонта. / Automatic stages passed; manual acceptance remains open. Not a repair FAIL.

Старый REBOOT_REQUIRED (4) относился к legacy RAW-движку. Активный 0.3-пакет его не запускает и не выдаёт свидетельство полного SSD PASS после нескольких загрузок.

Legacy REBOOT_REQUIRED (4) belonged to the old RAW engine. The active 0.3 package does not execute that backend or claim a multi-boot full-device PASS.
