#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Metadata is obtained twice; the scanner opens only O_RDONLY. No repair/unmount.
readonly_preflight(){
  local disk xml contract extra
  disk=$1
  case "$disk" in disk0|disk[1-9]*) ;;*)unknown READONLY_DEVICE_INVALID;return 3;;esac
  [[ "$disk" =~ ^disk(0|[1-9][0-9]{0,3})$ ]] || { unknown READONLY_DEVICE_INVALID;return 3; }
  xml=$(pf_read 12 diskutil info -plist "/dev/$disk") || { unknown READONLY_METADATA_UNAVAILABLE;return 3; }
  printf '%s\n' "$xml" > "$STEP_DIR/read-target.plist" || return 3
  contract=$(perl "$ROOT/storage_readonly.pl" --metadata "$disk" < "$STEP_DIR/read-target.plist") || {
    unknown READONLY_PHYSICAL_WHOLE_DISK_NOT_CONFIRMED;return 3;
  }
  IFS=$'\t' read -r RO_DISK RO_BYTES RO_BLOCK extra <<< "$contract"
  [ -z "$extra" ] && [ "$RO_DISK" = "$disk" ] || { unknown READONLY_METADATA_INVALID;return 3; }
  RO_CONTRACT=$contract
  printf 'device\t/dev/%s\nbytes\t%s\nsector_bytes\t%s\naccess\tO_RDONLY\n' "$RO_DISK" "$RO_BYTES" "$RO_BLOCK" > "$STEP_DIR/read-target.tsv" || return 3
}
readonly_main(){
  local listing disk mode rc original budget
  [ "$KERNEL" = Darwin ] && [ "${PROFILE_POLICY:-observe}" != observe ] && profile_validate || { unknown READONLY_PROFILE_UNAVAILABLE;return 3; }
  [ "${CAP_PERL:-no}" = yes ] && [ "${CAP_SUPERVISOR:-no}" = yes ] && need diskutil || { unknown READONLY_TOOLS_UNAVAILABLE;return 3; }
  pf_probe 5 perl -MFcntl=O_RDONLY,O_NOFOLLOW,SEEK_SET,S_ISCHR -MConfig -MErrno -e 'exit($Config{ivsize}>=8?0:3)' || { unknown READONLY_PERL_CAPABILITY_UNAVAILABLE;return 3; }
  listing=$(pf_read 12 diskutil list) || { unknown READONLY_DEVICE_LIST_UNAVAILABLE;return 3; }
  printf '%s\n' "$listing" | tee "$STEP_DIR/read-disk-list.txt"
  say 'RU: Выберите целый физический диск: disk0, disk1 и т.д. Номер не угадывайте. Enter — отмена.'
  say 'EN: Select a whole physical disk (disk0, disk1, etc.). Do not guess its number. Enter cancels.'
  printf '> ';read_reply || { unknown READONLY_NOT_AUTHORIZED;return 3; };disk=$REPLY
  readonly_preflight "$disk" || return 3
  original=$RO_CONTRACT
  cp "$STEP_DIR/read-target.plist" "$STEP_DIR/read-target.initial.plist" || return 3
  printf 'READONLY_TARGET=/dev/%s BYTES=%s LOGICAL_SECTOR=%s\n' "$RO_DISK" "$RO_BYTES" "$RO_BLOCK"
  say 'RU: Сначала сохраните важные данные. Даже чтение нагружает повреждённый HDD. Тест не восстанавливает данные.'
  say 'EN: Back up important data first. Reading still stresses a failing drive. This is not data recovery.'
  say 'RU: 1 — выборочное чтение до 32 МиБ (не весь диск); 2 — чтение всего логического объёма; Enter — отмена.'
  say 'EN: 1 — sample up to 32 MiB (partial); 2 — read the complete logical capacity; Enter cancels.'
  printf '> ';read_reply || { unknown READONLY_NOT_AUTHORIZED;return 3; }
  case "$REPLY" in 1)mode=quick;budget=900;;2)mode=full;budget=86400;;*)unknown READONLY_NOT_AUTHORIZED;return 3;;esac
  say 'RU: Никаких записей тестовых данных, форматирования, ремонта или размонтирования. ОС и файлы журналов могут записывать данные отдельно.'
  say 'EN: No test-data writes, formatting, repair or unmount. The OS and log files can still write separately.'
  printf 'RU: Подтвердите чтение: READ %s\nEN: Confirm reading: READ %s\n> ' "$disk" "$disk"
  read_reply && [ "$REPLY" = "READ $disk" ] || { unknown READONLY_NOT_AUTHORIZED;return 3; }
  readonly_preflight "$disk" || return 3
  [ "$RO_CONTRACT" = "$original" ] || { unknown READONLY_TARGET_CHANGED;return 3; }
  printf 'mode\t%s\ntimeout_seconds\t%s\n' "$mode" "$budget" >> "$STEP_DIR/read-target.tsv" || return 3
  say "READONLY_PLAN mode=$mode disk=$disk bytes=$RO_BYTES sector=$RO_BLOCK logs=$STEP_DIR"
  say 'RU: Остановка при первой ошибке чтения. Медленные блоки — наблюдения, а не доказанные bad sectors. Ctrl+C — остановить.'
  say 'EN: Stop on the first read error. Slow blocks are observations, not proven bad sectors. Ctrl+C stops.'
  capture "$budget" perl "$ROOT/storage_readonly.pl" --device "/dev/r$disk" "$RO_BYTES" "$RO_BLOCK" "$mode" "$budget";rc=$?
  case "$rc" in 129|130|143)return "$rc";;esac
  case "$rc" in
    0)
      if [ "$mode" = full ] && grep -qx 'ENGINE_COMPLETE=READONLY_FULL_READ' "$STEP_DIR/engine.log";then
        result PASS 0 READONLY_FULL_READ_COMPLETED 'Весь указанный логический объём прочитан без ошибки чтения. Запись, правильность содержимого, файловая система и запасные физические области НЕ проверены.' 'The stated logical capacity was read without read errors. Writing, content correctness, filesystem consistency and spare physical areas were NOT verified.'
      elif [ "$mode" = quick ] && grep -qx 'ENGINE_COMPLETE=READONLY_SAMPLE_READ' "$STEP_DIR/engine.log";then
        result INCONCLUSIVE 3 READONLY_SAMPLE_CLEAN 'Выборочные диапазоны прочитаны. Это НЕ проверка всего диска; см. tested_bytes и planned_bytes.' 'Sampled ranges were readable. This is NOT a complete disk scan; see tested_bytes and planned_bytes.'
      else unknown READONLY_COMPLETION_MISSING;fi;;
    2)result FAIL 2 READONLY_READ_ERROR_OBSERVED 'Обнаружена ошибка чтения. Нагрузка остановлена; сохраните журнал. Причина может быть в накопителе, кабеле, контроллере или среде; повторными прогонами данные не восстанавливать.' 'A read-path error was observed. Load stopped; preserve the log. The drive, cable, controller or environment may be involved; repeated scans are not data recovery.';;
    *)unknown READONLY_INCOMPLETE_OR_ACCESS_DENIED;;
  esac
}
