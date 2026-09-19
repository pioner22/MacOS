#!/bin/bash
# Legacy raw engine is NOT an acceptance test. Kept disabled pending a separate audit.
echo 'RESULT=BLOCKED'
echo 'REASON=LEGACY_RAW_QUARANTINED'
echo 'RU: Разрушительный SSD-тест отключён до отдельного аудита. Используйте пункт 16 или 17 в st.sh.'
echo 'EN: Destructive SSD testing is quarantined. Use option 16 or 17 in st.sh instead.'
exit 7
