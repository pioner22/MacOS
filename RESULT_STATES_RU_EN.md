# Состояния / Result states

| Код / Code | Состояние / State | Русское значение | English meaning |
|---|---|---|---|
| 0 | PASS | Только запрошенные и завершённые проверки пройдены. | Requested, completed checks passed. |
| 2 | FAIL | Нарушено условие теста; аппаратная причина не локализована. | A test condition failed; hardware cause is not isolated. |
| 3 | INCONCLUSIVE | Среда, движок, timeout, отсутствующий эталон или неполное покрытие не позволили завершить проверку. | Environment, engine, timeout, missing reference, or incomplete execution prevents a verdict. |
| 4 | REBOOT_REQUIRED | Зарезервировано для будущего проверенного multi-boot backend; не PASS. | Reserved for a qualified future multi-boot backend; not PASS. |
| 5 | BLOCKED | Нет разрешения/цели либо опасный backend не допущен. | Missing consent/target or unsafe backend not qualified. |
| 6 | OBSERVATION | Сведения собраны, исправность узла не установлена. | Information collected; not a health verdict. |
| 130 | CANCELLED | Остановка пользователем/сигналом; не аппаратный FAIL. | User/signal cancellation; not a hardware FAIL. |

`attribution=UNCONFIRMED` означает, что причина не установлена независимо.  
`attribution=UNCONFIRMED` means the cause has not been independently established.

`SHA256_MISMATCH`: сверяемые байты отличаются; источник — сервер, путь передачи, RAM, CPU, библиотека или ошибка ПО — ещё не определён.  
`SHA256_MISMATCH`: compared bytes differ; server, transfer path, RAM, CPU, library or software cause is not yet isolated.

`RAM_MISMATCH`: не совпало прочитанное значение в тестовой аллокации. Не указывает номер DRAM-чипа.  
`RAM_MISMATCH`: a value read from the test allocation differed. Does not identify a DRAM chip.

`RANGE_NOT_SUPPORTED`: сервер не подтвердил требуемую частичную передачу; это не ошибка памяти ноутбука.  
`RANGE_NOT_SUPPORTED`: the server did not honor the partial-transfer request; not a laptop memory failure.

`MISSING_COMPLETION_MARKER`, `LOG_WRITE_FAILURE`, `ENGINE_TIMEOUT`: не объявлять PASS, проверить журнал и среду.  
`MISSING_COMPLETION_MARKER`, `LOG_WRITE_FAILURE`, `ENGINE_TIMEOUT`: do not declare PASS; inspect logs and environment.
