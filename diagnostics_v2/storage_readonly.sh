#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Recovery-compatible raw read test. NO target writes, filesystem repair or mount changes.
readonly_capability(){
  if [ "${KERNEL:-}" = Darwin ] && [ "${PROFILE_POLICY:-observe}" != observe ] &&
     [ "${CAP_PERL:-no}" = yes ] && [ "${CAP_SUPERVISOR:-no}" = yes ] && need diskutil;then
    printf 'perl_readonly_candidate'
  else printf 'unavailable';fi
}
ro_device_id(){
  local id=${1#/dev/}
  case "$id" in rdisk*)id=${id#r};;esac
  [[ "$id" =~ ^disk(0|[1-9][0-9]*)$ ]] || return 3
  [ "${#id}" -le 12 ] || return 3
  printf '%s\n' "$id"
}
# Accept a bounded set of exact English diskutil keys. Unknown formats fail closed.
# No device names, labels or paths are executed as code.
ro_parse_info(){
  LC_ALL=C awk -v want="$2" '
  /^[ \t]*[^:]+:/ {
    key=$0;sub(/:.*/,"",key);gsub(/^[ \t]+|[ \t]+$/,"",key)
    val=$0;sub(/^[^:]*:[ \t]*/,"",val);sub(/[ \t\r]+$/,"",val)
    if(key=="Device Identifier"||key=="Device Node"||key=="Whole"||key=="Disk Size"||key=="Total Size"||key=="Device Block Size"||key=="Virtual"||key=="Virtual or Physical") {
      if(seen[key]++)bad=1;v[key]=val
    }
  }
  END {
    if(bad || v["Device Identifier"]!=want || v["Device Node"]!="/dev/" want || v["Whole"]!="Yes")exit 3
    if(v["Virtual"]!="No" && v["Virtual or Physical"]!="Physical")exit 3
    if((v["Virtual"]!="" && v["Virtual"]!="No") || (v["Virtual or Physical"]!="" && v["Virtual or Physical"]!="Physical"))exit 3
    if(v["Disk Size"]!="" && v["Total Size"]!="")exit 3
    size=v["Disk Size"];if(size=="")size=v["Total Size"]
    if(!match(size,/\([0-9]+ Bytes\)/))exit 3
    n=substr(size,RSTART+1,RLENGTH-8)
    b=v["Device Block Size"];if(b!~/^[0-9]+ Bytes$/)exit 3;sub(/ Bytes$/,"",b)
    if(n!~/^[1-9][0-9]*$/ || length(n)>16 || (n+0)>1125899906842624 || b!~/^(512|1024|2048|4096|8192|16384|32768|65536)$/ || n%b!=0)exit 3
    print want "\t" n "\t" b
  }' "$1"
}
ro_metadata(){
  local id=$1 tag=$2 text parsed
  text=$(pf_read 10 diskutil info "/dev/$id" 2>"$STEP_DIR/ro-info-$tag.err") || {
    unknown STORAGE_RO_METADATA_UNAVAILABLE;return 3;
  }
  printf '%s\n' "$text" > "$STEP_DIR/ro-info-$tag.txt" || return 3
  parsed=$(ro_parse_info "$STEP_DIR/ro-info-$tag.txt" "$id") || { unknown STORAGE_RO_NOT_CONFIRMED_PHYSICAL_WHOLE;return 3; }
  IFS=$'\t' read -r RO_ID RO_BYTES RO_SECTOR <<< "$parsed"
  RO_SIGNATURE="$parsed
$(awk -F: '/^[ \t]*(Device \/ Media Name|Disk \/ Partition UUID|Protocol|Device Location):/{sub(/^[ \t]+/,"");sub(/[ \t]+$/,"");print}' "$STEP_DIR/ro-info-$tag.txt")"
}
# Last persisted progress is a lower bound if a process or machine was interrupted.
ro_read_bytes(){
  awk '/^RO_PROGRESS /{for(i=1;i<=NF;i++)if($i~/^read_bytes=[0-9]+$/){split($i,a,"=");n=a[2]}}
       /^RO_SUMMARY_read_bytes=[0-9]+$/{split($0,a,"=");n=a[2]}
       END{print (n==""?"0":n)}' "$1"
}
ro_coverage(){
  local state=$1 readbytes=0
  if [ -f "$STEP_DIR/engine.log" ];then readbytes=$(ro_read_bytes "$STEP_DIR/engine.log");fi
  printf 'test\tPHYSICAL_DEVICE_READABILITY\nplanned_bytes\t%s\nread_bytes\t%s\nlogical_sector_bytes\t%s\nstate\t%s\ncontent_checksum\tNOT_TESTED\nwrite_test\tNOT_PERFORMED\n' \
    "$RO_BYTES" "$readbytes" "$RO_SECTOR" "$state" > "$STEP_DIR/read-coverage.tmp" && mv "$STEP_DIR/read-coverage.tmp" "$STEP_DIR/read-coverage.tsv"
}
# Finalize only this stage's read counter after the shell was interrupted.
ro_finalize_coverage(){
  local dir=$1 bytes
  [ -f "$dir/read-coverage.tsv" ] || return 0
  bytes=0;[ ! -f "$dir/engine.log" ] || bytes=$(ro_read_bytes "$dir/engine.log")
  awk -F '\t' -v n="$bytes" 'BEGIN{OFS="\t"} $1=="read_bytes"{$2=n} $1=="state" && $2=="RUNNING"{$2="INCOMPLETE"} {print}' \
    "$dir/read-coverage.tsv" > "$dir/read-coverage.tmp" && mv "$dir/read-coverage.tmp" "$dir/read-coverage.tsv"
}
readonly_main(){
  local id signature rc out list
  [ "$(readonly_capability)" = perl_readonly_candidate ] && profile_validate || {
    unknown STORAGE_RO_RUNTIME_UNAVAILABLE;return 3;
  }
  if ! pf_probe 5 perl -MFcntl=O_RDONLY,O_NOFOLLOW,S_ISCHR -MConfig -MErrno=EIO,EINTR,ENXIO,ENODEV \
      -e 'exit(($Config{ivsize}||0)>=8 && ($Config{lseeksize}||0)>=8 ? 0 : 1)' > "$STEP_DIR/ro-prerequisites.log" 2>&1;then
    unknown STORAGE_RO_PERL_CAPABILITY_UNAVAILABLE;return 3;
  fi
  list=$(pf_read 10 diskutil list 2>"$STEP_DIR/ro-list.err") || { unknown STORAGE_RO_DISK_LIST_UNAVAILABLE;return 3; }
  printf '%s\n' "$list" | tee "$STEP_DIR/ro-list.txt"
  say 'RU: Только чтение физического HDD/SSD. При щелчках, исчезновении диска или незаменимых данных сначала восстановление/копия, НЕ полный скан.'
  say 'EN: Physical HDD/SSD read only. If clicking, disconnecting or holding irreplaceable data, recover/copy first; do NOT run a full scan.'
  printf 'RU: Введите целый диск, например disk0; Enter — отмена. Разделы и виртуальные APFS-диски запрещены.\nEN: Enter a whole physical disk, e.g. disk0; Enter cancels. No partitions or virtual APFS disks.\n> '
  read_reply || { unknown STORAGE_RO_NOT_AUTHORIZED;return 3; }
  id=$(ro_device_id "$REPLY") || { unknown STORAGE_RO_DISK_NOT_SELECTED;return 3; }
  ro_metadata "$id" before || return 3; signature=$RO_SIGNATURE
  cat "$STEP_DIR/ro-info-before.txt"
  say "READONLY_PLAN device=/dev/r$id bytes=$RO_BYTES logical_sector=$RO_SECTOR memory_buffer_mib=4 time_limit_hours=24"
  say "REPORT_DIRECTORY=$SESSION"
  say 'RU: Движок НЕ записывает на выбранный диск. Записи ОС и файлов журналов отдельно не запрещены; для логов желательно другое устройство.'
  say 'EN: The reader will NOT write to the selected device. OS/log-file writes are not blocked; another device is preferred for logs.'
  say 'RU: Полный проход может занять часы. Остановка при первой ошибке; без повторов, исправления, размонтирования и изменения разделов.'
  say 'EN: A full pass can take hours. Stop on first error; no retry, repair, unmount or partition changes.'
  printf 'RU: Для старта введите READ %s\nEN: To start type READ %s\n> ' "$id" "$id"
  read_reply && [ "$REPLY" = "READ $id" ] || { unknown STORAGE_RO_NOT_AUTHORIZED;return 3; }
  # Re-read metadata after the user prompt; never silently switch to a new size/device.
  ro_metadata "$id" confirmed || return 3
  [ "$RO_SIGNATURE" = "$signature" ] || { unknown STORAGE_RO_DEVICE_CHANGED;return 3; }
  ro_coverage RUNNING || return 3
  MACDIAG_STOP_GRACE=10 capture 86400 perl "$ROOT/storage_readonly.pl" "/dev/r$id" "$RO_BYTES" "$RO_SECTOR" 86380;rc=$?
  ro_coverage INCOMPLETE || return 3
  case "$rc" in
    0)
      grep -qx 'ENGINE_COMPLETE=STORAGE_READONLY_PASS' "$STEP_DIR/engine.log" &&
        grep -qx "RO_SUMMARY_read_bytes=$RO_BYTES" "$STEP_DIR/engine.log" || { unknown STORAGE_RO_COMPLETION_MISSING;return 3; }
      ro_metadata "$id" after || return 3
      [ "$RO_SIGNATURE" = "$signature" ] || { unknown STORAGE_RO_DEVICE_CHANGED;return 3; }
      ro_coverage COMPLETED || return 3
      result PASS 0 STORAGE_RO_ALL_BYTES_READ 'Весь объявленный логический объём прочитан без ошибки чтения. Запись, сохранность содержимого и резервные физические сектора НЕ проверены.' 'The declared logical extent was read without read errors. Writes, content correctness and spare physical sectors were NOT tested.';;
    2) ro_coverage READ_ERROR || return 3; result FAIL 2 STORAGE_RO_READ_PATH_ERROR 'Чтение остановлено при ошибке. Сохраните журнал и сначала защитите данные; причина может быть в диске, кабеле, питании или контроллере.' 'Reading stopped on an error. Preserve the log and protect data first; the disk, cable, power or controller may be involved.';;
    129|130|143)return "$rc";;
    *) result INCONCLUSIVE 3 STORAGE_RO_INCOMPLETE 'Чтение не завершено: проверьте права, ограничение времени и engine.log. Не меняйте защиту системы автоматически; неполный скан не даёт PASS.' 'Read scan incomplete: check access, timeout and engine.log. Do not automatically disable system protections; a partial scan is not PASS.';;
  esac
}
