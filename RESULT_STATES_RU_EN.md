> Текущая версия: rc4. Приоритет изменений и критериев: [RC4_REVIEW_FIXES](docs/diagnostics/RC4_REVIEW_FIXES.md). / Current rc4 semantics take precedence.

# Результаты / Result states — v2

| Код / code | Состояние / state | RU | EN |
|---|---|---|---|
| 0 | PASS | Только выполненный этап прошёл по объявленным критериям. | Only the completed stage met its declared criteria. |
| 2 | FAIL | Ошибка проверяемых данных/пути; конкретный компонент не установлен. Self-test FAIL относится к комплекту. | Tested-data/path failure; component attribution is not established. Self-test FAIL concerns the toolkit. |
| 3 | INCONCLUSIVE | Нет полного результата: инструмент, права, mlock, тайм-аут, неизвестная среда, неполное покрытие или нестабильная передача. | Incomplete: tool, permission, mlock, timeout, unknown environment, missing coverage or unstable transfer. |
| 5 | OBSERVED | Только сбор сведений, не аппаратный PASS. | Observation only, not hardware PASS. |
| 6 | PENDING_MANUAL | Нужна ручная/независимая проверка, включая повтор после выключения. | Manual/independent checks and a cold-boot repeat remain. |
| 7 | BLOCKED | Тест намеренно заблокирован; старый RAW сейчас недоступен. | Deliberately blocked; legacy RAW testing is unavailable. |
| 130/143 | INTERRUPTED | Остановка/сигнал. Не считать аппаратным FAIL или завершённым PASS. | Interrupted by signal, neither hardware FAIL nor completed PASS. |

RU: Каждый этап пишет отдельный result.tsv; состояние и код должны совпасть. Пустой exit 0 не проходит gate. FAIL имеет приоритет в сводке. Успешный RAM-only тест не скрывает FAIL bridge. HTTP 404, отсутствие Release, ограничение mlock и ошибка компиляции сами по себе не доказывают неисправность ноутбука. Последний RUNNING в session.state без завершения — незавершённый сеанс, а не локализация причины отключения. Логи сбрасываются по мере выполнения, но сохранность хвоста при потере питания не гарантируется.

EN: Each stage writes a separate result.tsv and matching exit code. Empty exit 0 cannot pass. FAIL takes precedence in summaries. RAM success never hides bridge failure. HTTP 404, missing release assets, mlock refusal and compiler errors do not by themselves diagnose hardware. An unfinished RUNNING marker denotes incomplete execution, not its cause. Flushing logs reduces but does not eliminate power-loss data loss.
