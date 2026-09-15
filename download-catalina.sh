#!/bin/bash
# Catalina download helper 1.1.0. Full macOS 10.15+/Bash 3.2, not Recovery.
# Downloads ONE original file. No installation, mounts, network changes or sudo.
# Official documentation: https://curl.se/docs/manpage.html
# HTTP success, local integrity and Apple signature verification are distinct.
VERSION=1.1.0
DEFAULT_URL='https://swcdn.apple.com/content/downloads/26/37/001-68446/r1dbqtmf3mtpikjnd04cq31p4jk91dceh8/InstallESDDmg.pkg'
CURL=/usr/bin/curl
SHASUM=/usr/bin/shasum
HDIUTIL=/usr/bin/hdiutil
PKGUTIL=/usr/sbin/pkgutil
CAFFEINATE=/usr/bin/caffeinate
MAX_ATTEMPTS=3
RETRY_DELAY=10
TRANSFER_LIMIT=7200
RESERVE_BYTES=2147483648
LOCKED=0
WAKE_PID=
RUN=
SOCKS5=
COMMON=(-q -4 --http1.1 -fL --proto '=https' --proto-redir '=https' --max-redirs 5 -x '' --noproxy '*' --connect-timeout 20 -H 'Accept-Encoding: identity')

# Explicit SOCKS5h mode: destination DNS goes to the proxy. Never auto-fallback.
configure_transport() {
  local port
  COMMON=(-q -4 --http1.1 -fL --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 20 -H 'Accept-Encoding: identity')
  if [ -n "$SOCKS5" ]; then
    [[ "$SOCKS5" =~ ^127[.]0[.]0[.]1:[0-9]{1,5}$ ]] || die '--socks5 requires 127.0.0.1:PORT, without credentials.'
    port=${SOCKS5##*:}; port=$((10#$port))
    [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || die 'Invalid local SOCKS port.'
    SOCKS5="127.0.0.1:$port"
    COMMON+=(--proxy "socks5h://$SOCKS5" --noproxy '')
  else
    COMMON+=(-x '' --noproxy '*')
  fi
}

say() { printf '%s\n' "$*"; }
log() { say "$*"; [ -z "$RUN" ] || printf '%s\n' "$*" >> "$RUN/summary.txt"; }
die() { log "STOP: $*"; exit 1; }
file_size() { /usr/bin/stat -f '%z' "$1"; }
available_bytes() { df -Pk "$DEST" | awk 'NR==2 {printf "%.0f\n", $4*1024}'; }
is_uint() { [[ "$1" =~ ^[0-9]{1,12}$ ]] && [[ "$1" != 0[0-9]* ]]; }
allowed_url() { [[ "$1" =~ ^https://([A-Za-z0-9-]+\.)*apple\.com/[^[:space:]]+$ ]]; }
# Read only the FINAL HTTP header block, never the redirect's size or validator.
header() {
  awk -v k="$2" '
    /^HTTP\// {v=""; next}
    {line=$0; sub(/\r$/, "", line); p=index(line, ":")
     if (p && tolower(substr(line,1,p-1))==tolower(k)) {
       v=substr(line,p+1); sub(/^[ \t]+/, "", v)
     }} END {print v}' "$1"
}
http_status() { awk '/^HTTP\// {v=$2} END {print v}' "$1"; }
validator() {
  local etag last
  etag=$(header "$1" ETag); last=$(header "$1" Last-Modified)
  VALIDATOR=; VALIDATOR_KIND=
  case "$etag" in \"*\") VALIDATOR=$etag; VALIDATOR_KIND=ETag;; esac
  if [ -z "$VALIDATOR" ] && [ -n "$last" ]; then VALIDATOR=$last; VALIDATOR_KIND=Last-Modified; fi
}
clean_exit() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ -n "$WAKE_PID" ]; then kill "$WAKE_PID" 2>/dev/null || :; wait "$WAKE_PID" 2>/dev/null || :; fi
  if [ "$LOCKED" = 1 ]; then
    /bin/rm -f "$DEST/.download.lock/pid"
    /bin/rmdir "$DEST/.download.lock" 2>/dev/null || :
  fi
  if [ "$rc" != 0 ]; then
    say "Операция остановлена. Частичный файл сохранён; не выдавайте его за полный."
    [ -z "$RUN" ] || say "Журнал: $RUN/summary.txt"
  fi
  exit "$rc"
}
lock_destination() {
  local old
  if [ -L "$DEST/.download.lock" ]; then die 'Lock path is a symlink.'; fi
  if ! mkdir "$DEST/.download.lock" 2>/dev/null; then
    [ -d "$DEST/.download.lock" ] && [ -f "$DEST/.download.lock/pid" ] && [ ! -L "$DEST/.download.lock/pid" ] || die 'Unknown lock; inspect it, do not run concurrently.'
    IFS= read -r old < "$DEST/.download.lock/pid"
    is_uint "$old" && [ "$old" -gt 1 ] || die 'Invalid saved lock PID.'
    kill -0 "$old" 2>/dev/null && die "Другая операция/PID $old ещё работает. Второй запуск запрещён."
    /bin/rm "$DEST/.download.lock/pid" && /bin/rmdir "$DEST/.download.lock" && mkdir "$DEST/.download.lock" || die 'Cannot recover a stale lock.'
  fi
  LOCKED=1
  printf '%s\n' "$$" > "$DEST/.download.lock/pid" || die 'Cannot write lock.'
}
write_metadata() {
  printf '%s\n' "$URL" "$TOTAL" "$VALIDATOR_KIND" "$VALIDATOR" > "$1"
}
probe_remote() {
  local rc effective mime headers=$1
  "$CURL" "${COMMON[@]}" -sS -I --max-time 60 -D "$headers" -o /dev/null \
    -w '%{url_effective}\n' "$URL" > "$headers.url" 2> "$headers.stderr"
  rc=$?; log "HEAD_CURL_EXIT=$rc"
  [ "$rc" = 0 ] || { cat "$headers.stderr" >&2; die 'HEAD-запрос не выполнен. См. headers/stderr; TLS не отключайте.'; }
  [ "$(http_status "$headers")" = 200 ] || die 'Ожидался HTTP 200 для метаданных файла.'
  IFS= read -r effective < "$headers.url"
  allowed_url "$effective" || die 'Unexpected non-Apple/non-HTTPS redirect.'
  TOTAL=$(header "$headers" Content-Length)
  is_uint "$TOTAL" && [ "$TOTAL" -gt 0 ] && [ "$TOTAL" -le 42949672960 ] || die 'Missing/invalid Content-Length or file exceeds 40 GiB. Nothing downloaded.'
  mime=$(header "$headers" Content-Type)
  case "$mime" in text/*|application/json*) die 'Сервер вернул текст/JSON, а не установочные данные.';; esac
  validator "$headers"
  log "REMOTE_BYTES=$TOTAL"
  log "EFFECTIVE_URL=$effective"
  log "RESUME_VALIDATOR=${VALIDATOR_KIND:-NONE}"
}
check_space() {
  local have=$1 free needed
  free=$(available_bytes)
  is_uint "$free" || die 'Cannot determine free disk space.'
  needed=$((TOTAL-have+RESERVE_BYTES))
  [ "$free" -ge "$needed" ] || die "Недостаточно места: нужно $needed байт с резервом; свободно $free."
}
validate_response() {
  local head=$1 offset=$2 code range expected remaining got kind value
  code=$(http_status "$head")
  if [ "$offset" = 0 ]; then
    [ "$code" = 200 ] || return 1
  else
    [ "$code" = 206 ] || return 1
    range=$(header "$head" Content-Range)
    expected="bytes $offset-$((TOTAL-1))/$TOTAL"
    [ "$range" = "$expected" ] || return 1
  fi
  got=$(header "$head" Content-Length); remaining=$((TOTAL-offset))
  [ -z "$got" ] || [ "$got" = "$remaining" ] || return 1
  kind=$VALIDATOR_KIND; value=$VALIDATOR
  if [ -n "$kind" ]; then
    got=$(header "$head" "$kind")
    # A differing validator invalidates the partial file, even with curl exit 0.
    [ -z "$got" ] || [ "$got" = "$value" ] || return 1
  fi
  got=$(header "$head" Content-Encoding)
  [ -z "$got" ] || [ "$got" = identity ]
}
transient_error() { case "$1" in 5|6|7|18|28|52|55|56|92) return 0;; *) return 1;; esac; }
download_file() {
  local attempt offset after rc effective codes args head
  probe_remote "$RUN/head-1.txt"
  write_metadata "$RUN/current.meta" || die 'Cannot save metadata.'
  if [ -f "$DEST/source.meta" ]; then
    cmp -s "$RUN/current.meta" "$DEST/source.meta" || die 'URL/size/validator changed. Old files retained; use a NEW output directory.'
  else
    [ ! -e "$PART" ] && [ ! -e "$FINAL" ] || die 'Existing file has no provenance metadata; not imported or overwritten.'
    cp "$RUN/current.meta" "$DEST/source.meta" || die 'Cannot store source metadata.'
  fi
  [ ! -e "$DEST/unsafe-partial" ] || die 'Previous response was inconsistent. Keep logs and use a NEW output directory.'
  if [ -f "$FINAL" ]; then
    [ "$(file_size "$FINAL")" = "$TOTAL" ] && [ -f "$DEST/transfer.ok" ] || die 'Existing final file is incomplete/unrecorded.'
    log 'Файл уже загружен; повторно проверяем его без новой передачи.'; return 0
  fi
  for ((attempt=1;attempt<=MAX_ATTEMPTS;attempt++)); do
    if [ "$attempt" -gt 1 ]; then
      probe_remote "$RUN/head-$attempt.txt"
      write_metadata "$RUN/current.meta"
      cmp -s "$RUN/current.meta" "$DEST/source.meta" || die 'Remote object changed between attempts; partial retained.'
    fi
    offset=0; [ ! -f "$PART" ] || offset=$(file_size "$PART")
    is_uint "$offset" && [ "$offset" -le "$TOTAL" ] || die 'Invalid/oversized partial file.'
    if [ "$offset" = "$TOTAL" ]; then
      [ -f "$DEST/transfer.ok" ] || die 'Full-sized partial has no successful curl record; inspect logs before reuse.'
      break
    fi
    [ "$offset" = 0 ] || [ -n "$VALIDATOR" ] || die 'No ETag/Last-Modified: safe resume is unavailable. File retained.'
    check_space "$offset"
    log "ATTEMPT=$attempt/$MAX_ATTEMPTS OFFSET=$offset TOTAL=$TOTAL"
    log 'curl ниже показывает проценты, байты, среднюю/текущую скорость и время оставшейся передачи.'
    args=(); [ "$offset" = 0 ] || args=(-C "$offset" -H "If-Range: $VALIDATOR")
    head="$RUN/get-$attempt.headers"
    # Capture PIPESTATUS immediately. A successful tee is NOT curl success.
    "$CURL" "${COMMON[@]}" "${args[@]}" --max-time "$TRANSFER_LIMIT" \
      --speed-limit 1024 --speed-time 120 -D "$head" -o "$PART" \
      -w '\nMETRICS http=%{http_code} bytes=%{size_download} seconds=%{time_total} bytes_per_sec=%{speed_download} remote_ip=%{remote_ip} tls_verify=%{ssl_verify_result}\nEFFECTIVE_URL=%{url_effective}\n' \
      "$URL" 2>&1 | tee "$RUN/get-$attempt.curl.log"
    codes=("${PIPESTATUS[@]}"); rc=${codes[0]}
    after=0; [ ! -f "$PART" ] || after=$(file_size "$PART")
    log "CURL_EXIT=$rc OFFSET_BEFORE=$offset FILE_BYTES_AFTER=$after EXPECTED_BYTES=$TOTAL"
    [ "${codes[1]}" = 0 ] || die 'Не удалось сохранить журнал (tee); проверьте свободное место.'
    [ "$rc" -lt 128 ] || die 'curl аварийно завершился. Повторные загрузки остановлены.'
    is_uint "$after" && [ "$after" -ge "$offset" ] && [ "$after" -le "$TOTAL" ] || {
      : > "$DEST/unsafe-partial"; die 'Partial size is inconsistent; no automatic reuse.';
    }
    if [ "$after" -gt "$offset" ] || [ "$rc" = 0 ]; then
      effective=$(sed -n 's/^EFFECTIVE_URL=//p' "$RUN/get-$attempt.curl.log" | tail -n 1)
      if ! allowed_url "$effective" || ! validate_response "$head" "$offset"; then
        : > "$DEST/unsafe-partial"; die 'HTTP/Range/validator mismatch; data retained but NOT approved for resume.'
      fi
    fi
    if [ "$rc" = 0 ]; then
      [ "$after" = "$TOTAL" ] || die 'curl returned 0 but final file size is wrong.'
      printf 'curl_exit=0\nbytes=%s\nrun=%s\n' "$after" "$RUN" > "$DEST/transfer.ok" || die 'Cannot record transfer completion.'
      break
    fi
    if [ "$attempt" = "$MAX_ATTEMPTS" ] || ! transient_error "$rc"; then
      die "Загрузка не завершена (curl=$rc). Частичный файл сохранён."
    fi
    log "Пауза $RETRY_DELAY с; затем ограниченный повтор с продолжением, если доступно."
    sleep "$RETRY_DELAY"
  done
  [ -f "$DEST/transfer.ok" ] && [ "$(file_size "$PART")" = "$TOTAL" ] || die 'Completion cannot be confirmed.'
  mv "$PART" "$FINAL" || die 'Cannot finalize file.'
  log "DOWNLOAD_OK: полностью получено $TOTAL байт. Подлинность пока НЕ подтверждена."
}
verify_file() {
  local digest old magic trailer size rc filetype
  log 'Вычисление SHA-256 сохранённого файла; установка и монтирование не запускаются.'
  digest=$("$SHASUM" -a 256 < "$FINAL"); rc=$?; digest=${digest%% *}
  [ "$rc" = 0 ] && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die 'SHA-256 calculation failed.'
  if [ -f "$DEST/InstallESDDmg.sha256" ]; then
    IFS=' ' read -r old ignored < "$DEST/InstallESDDmg.sha256"
    [ "$old" = "$digest" ] || die 'Local file hash CHANGED since the previous run. Stop and inspect storage.'
  else
    printf '%s  InstallESDDmg.pkg\n' "$digest" > "$DEST/InstallESDDmg.sha256" || die 'Cannot save SHA-256.'
  fi
  log "SHA256=$digest"
  log 'Собственный хеш — отпечаток файла, не доказательство подлинности без доверенного эталона.'
  filetype=$(file -b "$FINAL") || die 'Cannot read downloaded file.'
  log "FILE_TYPE=$filetype"
  magic=$(od -An -tx1 -N4 "$FINAL" | tr -d ' \n')
  size=$(file_size "$FINAL"); trailer=
  if [ "$size" -ge 512 ]; then trailer=$(od -An -tx1 -j "$((size-512))" -N4 "$FINAL" | tr -d ' \n'); fi
  # Some InstallESDDmg.pkg objects are DMG images despite their .pkg extension.
  if [ "$magic" = 78617221 ]; then
    log 'Формат XAR/PKG: штатная проверка подписи (pkgutil), без запуска пакета.'
    "$PKGUTIL" --check-signature "$FINAL" > "$RUN/verification.txt" 2>&1; rc=$?
    cat "$RUN/verification.txt"
    log "FORMAT=PKG PKGUTIL_EXIT=$rc"
    [ "$rc" = 0 ] || die 'Файл получен, но pkgutil не подтвердил подпись. Файл сохранён; изучите verification.txt.'
    log 'SIGNATURE_CHECK_COMMAND_OK: проверьте подписанта и цепочку в verification.txt; установка не проверена.'
  elif [ "$trailer" = 6b6f6c79 ]; then
    log 'Формат UDIF/DMG внутри файла .pkg: проверка образа (hdiutil), без монтирования.'
    "$HDIUTIL" verify "$FINAL" > "$RUN/verification.txt" 2>&1; rc=$?
    cat "$RUN/verification.txt"
    log "FORMAT=DMG HDIUTIL_EXIT=$rc"
    [ "$rc" = 0 ] || die 'Файл получен, но hdiutil verify не завершился успешно. Файл сохранён.'
    if grep -qi 'no checksum' "$RUN/verification.txt"; then
      die 'В образе нет встроенной контрольной суммы: успешный код hdiutil недостаточен.'
    fi
    log 'IMAGE_VERIFY_OK: проверка образа выполнена; подписи пакетов внутри и отзыв сертификатов НЕ проверены.'
  else
    log 'FORMAT=UNKNOWN'
    die 'Полученные байты не распознаны как ожидаемый PKG/DMG. Сохранены для диагностики, не использовать для установки.'
  fi
  log 'READY_FOR_REVIEW: файл и отчёты сохранены. Это не готовая флешка и не гарантия установки.'
  log "FILE=$FINAL"
  log "REPORT=$RUN/summary.txt"
}
main() {
  set +x
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077
  set -o pipefail
  local tool model os path
  URL=$DEFAULT_URL
  DEST="$HOME/macOS-rescue/Catalina-001-68446"
  case "${1:-}" in --help|-h) say 'bash download-catalina.sh [--output DIRECTORY] [--url HTTPS_APPLE_URL] [--socks5 127.0.0.1:PORT]'; return 0;; esac
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --output) [ "$#" -ge 2 ] || die '--output requires a path'; DEST=$2; shift 2;;
      --socks5) [ "$#" -ge 2 ] || die '--socks5 requires an endpoint'; SOCKS5=$2; shift 2;;
      --url) [ "$#" -ge 2 ] || die '--url requires a URL'; URL=$2; shift 2;;
      *) die 'Unknown argument. Use --help.';;
    esac
  done
  [ "$EUID" != 0 ] || die 'Запускайте на A1398 в обычной macOS, БЕЗ sudo; не в Recovery.'
  configure_transport
  allowed_url "$URL" || die 'Only an HTTPS URL on apple.com subdomains is accepted.'
  case "$DEST" in /*) ;; *) die 'Output directory must be an absolute path.';; esac
  for tool in "$CURL" "$SHASUM" "$CAFFEINATE" "$HDIUTIL" "$PKGUTIL" /usr/bin/sw_vers /usr/sbin/sysctl /usr/bin/stat; do
    [ -x "$tool" ] || die "Отсутствует $tool. Ничего автоматически не устанавливается."
  done
  for tool in awk cat chmod cmp cp date df file grep mkdir mv od rm rmdir sed sleep tail tee tr; do
    command -v "$tool" >/dev/null || die "Missing tool: $tool"
  done
  os=$(/usr/bin/sw_vers -productVersion) || die 'sw_vers failed.'
  model=$(/usr/sbin/sysctl -n hw.model) || die 'sysctl failed.'
  [ ! -L "$DEST" ] || die 'Output directory must not be a symlink.'
  mkdir -p "$DEST" || die 'Cannot create output directory.'
  DEST=$(cd "$DEST" && pwd -P) || die 'Cannot resolve output directory.'
  [ "$(stat -f '%u' "$DEST")" = "$EUID" ] || die 'Output directory belongs to another user.'
  for path in .download.lock logs source.meta transfer.ok unsafe-partial InstallESDDmg.pkg InstallESDDmg.pkg.part InstallESDDmg.sha256; do
    [ ! -L "$DEST/$path" ] || die "Unsafe symlink: $path"
  done
  chmod 700 "$DEST" || die 'Cannot protect output directory.'
  trap clean_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  lock_destination
  mkdir -p "$DEST/logs" || die 'Cannot create logs.'
  RUN="$DEST/logs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$RUN" || die 'Cannot create run log directory.'
  PART="$DEST/InstallESDDmg.pkg.part"; FINAL="$DEST/InstallESDDmg.pkg"
  log "CATALINA DOWNLOAD $VERSION | macOS=$os | model=$model"
  log "UTC=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  log "URL=$URL"
  log "DEST=$DEST"
  log 'Один файл. Нет Homebrew, sudo, установки macOS или форматирования.'
  if [ -n "$SOCKS5" ]; then
    log "TRANSPORT=SOCKS5H ENDPOINT=$SOCKS5 DIRECT_FALLBACK=DISABLED"
    log 'HEAD и GET используют прокси; remote_ip в curl может быть локальным адресом прокси, не адресом Apple.'
  else
    log 'TRANSPORT=DIRECT (HTTP/SOCKS proxy disabled for these requests)'
  fi
  log 'Исходный журнал использовал HTTP; здесь HTTPS. Это отдельная проверка доставки.'
  "$CURL" -q --version > "$RUN/curl-version.txt" 2>&1 || die 'System curl failed.'
  "$CAFFEINATE" -is -w $$ > "$RUN/caffeinate.txt" 2>&1 &
  WAKE_PID=$!
  sleep 1
  kill -0 "$WAKE_PID" 2>/dev/null || die 'caffeinate did not start; keep power attached and inspect logs.'
  log 'Запрет автоматического сна включён на время работы. Питание подключено, крышку не закрывать.'
  download_file
  verify_file
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
