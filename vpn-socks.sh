#!/bin/bash
# BigSurVPN SOCKS5 emergency backend for macOS Big Sur Intel.
set +x
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
export LC_ALL=C
unset BASH_ENV ENV CDPATH
umask 077
BASE=/Library/BigSurVPN
PRIVATE="$BASE/private"
STATE="$PRIVATE/socks-state"
REPORT="$PRIVATE/socks-report.txt"
HOST='144.31.180.114'
PORT='45004'
USER='proxy_user'
PASS='AiOZTgkvdMjlgeYG'
VERSION='2.1.0'
SELF="$BASE/vpn-socks.sh"
LINK=/usr/local/bin/vpn-bigsur
say(){ printf '%s\\n' "$*"; }
die(){ say "ОШИБКА: $*" >&2; exit 1; }
need_root(){ if [ "$EUID" -ne 0 ]; then exec /usr/bin/sudo /bin/bash "$SELF" "$@"; fi; }
service_for_default_route(){
  local dev svc
  dev=$(/sbin/route -n get default 2>/dev/null | /usr/bin/awk '/^[[:space:]]*interface:/{print $2;exit}')
  [ -n "$dev" ] || die "Не найден интерфейс маршрута по умолчанию."
  svc=$(/usr/sbin/networksetup -listnetworkserviceorder | /usr/bin/awk -v d="$dev" '/^\\([0-9]+\\)/ { s=$0; sub(/^\\([0-9]+\\)[[:space:]]*/, "", s); next } index($0, "Device: " d ")") { print s; exit }')
  [ -n "$svc" ] || die "Не найден сетевой сервис macOS для $dev."
  printf '%s' "$svc"
}
proxy_dump(){ /usr/sbin/networksetup -getsocksfirewallproxy "$1"; }
field(){ printf '%s\\n' "$1" | /usr/bin/awk -F': ' -v k="$2" '$1==k{print substr($0,index($0,": ")+2);exit}'; }
save_state(){
  local svc dump enabled server port auth
  svc=$1
  [ ! -f "$STATE" ] || return 0
  dump=$(proxy_dump "$svc") || die "Не удалось прочитать прежние SOCKS-настройки."
  enabled=$(field "$dump" Enabled); server=$(field "$dump" Server); port=$(field "$dump" Port); auth=$(field "$dump" "Authenticated Proxy Enabled")
  { printf 'SERVICE=%q\\n' "$svc"; printf 'ENABLED=%q\\n' "$enabled"; printf 'SERVER=%q\\n' "$server"; printf 'PORT_OLD=%q\\n' "$port"; printf 'AUTH=%q\\n' "$auth"; } > "$STATE"
  /bin/chmod 600 "$STATE"
 }
load_state(){
  [ -f "$STATE" ] || return 1
  [ "$(/usr/bin/stat -f '%u:%Lp' "$STATE")" = "0:600" ] || die "Небезопасные права файла состояния."
  . "$STATE"
 }
test_proxy(){
  local ip
  ip=$(/usr/bin/curl -q -4 -fsS --connect-timeout 8 --max-time 20 --socks5-hostname "$HOST:$PORT" --proxy-user "$USER:$PASS" https://ifconfig.me/ip) || die "SOCKS5 не прошёл HTTPS-проверку."
  case "$ip" in *[!0-9.]*|'') die "Через SOCKS5 получен некорректный IPv4.";; esac
  say "SOCKS5: PASS"; say "IP через SOCKS5: $ip"
  { printf 'Backend: SOCKS5\\nResult: PASS\\nProxy: %s:%s\\nExternal-IP: %s\\nChecked: %s\\n' "$HOST" "$PORT" "$ip" "$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')"; } > "$REPORT"
  /bin/chmod 600 "$REPORT"
 }
cmd_setup(){
  need_root setup
  [ "$(/usr/bin/uname -s)" = Darwin ] || die "Требуется macOS."
  case "$(/usr/bin/sw_vers -productVersion)" in 11.*) ;; *) die "Эта версия рассчитана на Big Sur 11.x.";; esac
  /bin/mkdir -p "$PRIVATE"; /bin/chmod 755 "$BASE"; /bin/chmod 700 "$PRIVATE"
  /bin/cp "$0" "$SELF"; /bin/chmod 700 "$SELF"
  /bin/mkdir -p /usr/local/bin; /bin/chmod 755 /usr/local /usr/local/bin
  if [ -e "$LINK" ] || [ -L "$LINK" ]; then /bin/rm -f "$LINK"; fi
  /bin/ln -s "$SELF" "$LINK"
  cmd_on
 }
cmd_on(){
  need_root on
  local svc
  svc=$(service_for_default_route); save_state "$svc"
  /usr/sbin/networksetup -setsocksfirewallproxy "$svc" "$HOST" "$PORT" on "$USER" "$PASS" >/dev/null
  /usr/sbin/networksetup -setsocksfirewallproxystate "$svc" on >/dev/null
  say "Backend: SOCKS5"; say "Сервис: $svc"; test_proxy
 }
cmd_off(){
  need_root off
  if ! load_state; then say "SOCKS5: сохранённого состояния нет."; return 0; fi
  if [ "$AUTH" = Yes ] && [ -n "$SERVER" ] && [ "$PORT_OLD" != 0 ]; then die "Предыдущий SOCKS использовал авторизацию; пароль macOS не раскрывает. Автовосстановление небезопасно."; fi
  if [ -n "$SERVER" ] && [ "$PORT_OLD" != 0 ]; then /usr/sbin/networksetup -setsocksfirewallproxy "$SERVICE" "$SERVER" "$PORT_OLD" >/dev/null; fi
  case "$ENABLED" in Yes) /usr/sbin/networksetup -setsocksfirewallproxystate "$SERVICE" on >/dev/null;; *) /usr/sbin/networksetup -setsocksfirewallproxystate "$SERVICE" off >/dev/null;; esac
  /bin/rm -f "$STATE"; say "SOCKS5 выключен; прежнее состояние системного SOCKS восстановлено."
 }
cmd_status(){
  need_root status
  local svc dump
  svc=$(service_for_default_route); dump=$(proxy_dump "$svc") || die "Не удалось прочитать SOCKS-настройки."
  say "Backend: SOCKS5"; say "Сервис: $svc"; say "$dump" | /usr/bin/sed -E 's/(Password:).*/\\1 [СКРЫТО]/'
 }
cmd_report(){ need_root report; [ -f "$REPORT" ] || die "Отчёта ещё нет."; /bin/cat "$REPORT"; }
cmd_test(){ need_root test; test_proxy; }
cmd_help(){ /bin/cat <<'EOF'
BigSurVPN SOCKS5
vpn-bigsur status  # состояние
vpn-bigsur test    # проверка SOCKS5 и внешнего IP
vpn-bigsur report  # последний отчёт
vpn-bigsur off     # выключить и восстановить прежний SOCKS
vpn-bigsur on      # включить
EOF
}
cmd=${1:-status}
case "$cmd" in setup) cmd_setup;; on) cmd_on;; off) cmd_off;; status) cmd_status;; test) cmd_test;; report) cmd_report;; help|--help|-h) cmd_help;; version|--version|-V) say "BigSurVPN SOCKS5 $VERSION";; *) die "Неизвестная команда. Используйте: vpn-bigsur --help";; esac
