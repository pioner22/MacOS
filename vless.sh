#!/bin/bash
# VLESS Recovery helper 0.1.0 (experimental). Bash 3.2, Intel macOS.
# Public file: no personal UUID, private URI, key or SSH credential.
# prepare: localhost-only test; start: explicit opt-in TUN routes and native DNS.
# No scutil write/reapply loop, pf changes, disk changes, TLS bypass or reboot service.
# Recovery compatibility is NOT established by the legacy binary's OS label.

VERSION=0.1.0
CORE_VERSION=1.14.0
ASSET=sing-box-1.14.0-darwin-amd64-legacy-macos-10.13.tar.gz
ASSET_SHA=99285bb2d30739dc8884144cf90f50538336eab9914ac4524290f5b82fdb5565
STATE=/private/tmp/recovery-vless
BIN=$STATE/sing-box
TUN=utun19
LOCAL_PORT=2080
OWN_PID=
LOCKED=0
say() { printf '%s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

# Strict input parsing: never eval a URI, shell-source a config, or print credentials.
decode_value() {
  local x=$1 h out=
  while [ -n "$x" ]; do
    if [ "${x:0:1}" = '%' ]; then
      [ "${#x}" -ge 3 ] || return 1
      h=${x:1:2}
      case "$h" in *[!0-9a-fA-F]*) return 1;; esac
      [ "$h" != 00 ] || return 1
      printf -v h '%b' "\\x$h"
      out=$out$h; x=${x:3}
    else
      out=$out${x:0:1}; x=${x:1}
    fi
  done
  VALUE=$out
}
parse_uri() {
  local u=$1 authority query item key value seen='|' p
  [ "${#u}" -le 4096 ] || die 'URI too long.'
  case "$u" in *$'\n'*|*$'\r'*) die 'URI must be a single line.';; esac
  case "$u" in vless://*\?*) ;; *) die 'Expected a VLESS URI with parameters.';; esac
  u=${u#vless://}; u=${u%%#*}; authority=${u%%\?*}; query=${u#*\?}
  UUID=${authority%%@*}; p=${authority#*@}
  [[ "$UUID" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]] || die 'Invalid UUID.'
  HOST=${p%:*}; PORT=${p##*:}
  [[ "$HOST" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] && [ "${#HOST}" -le 253 ] || die 'Only a DNS hostname or IPv4 server is supported.'
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || die 'Invalid server port.'
  PORT=$((10#$PORT)); [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die 'Invalid server port.'
  SECURITY=; FLOW=; FP=; PBK=; SID=; SNI=; TRANSPORT=; ENCRYPTION=; SPX=0
  while [ -n "$query" ]; do
    item=${query%%&*}; if [ "$query" = "$item" ]; then query=; else query=${query#*&}; fi
    case "$item" in *=*) ;; *) die 'Invalid URI parameter.';; esac
    key=${item%%=*}; value=${item#*=}
    case "$key" in security|flow|fp|pbk|sid|sni|type|encryption|spx) ;; *) die 'Unsupported URI parameter; no silent conversion.';; esac
    case "$seen" in *"|$key|"*) die 'Duplicate URI parameter.';; esac
    seen=$seen$key'|'
    decode_value "$value" || die 'Invalid percent encoding.'
    case "$key" in
      security) SECURITY=$VALUE;; flow) FLOW=$VALUE;; fp) FP=$VALUE;; pbk) PBK=$VALUE;;
      sid) SID=$VALUE;; sni) SNI=$VALUE;; type) TRANSPORT=$VALUE;; encryption) ENCRYPTION=$VALUE;;
      spx) SPX=1;;
    esac
  done
  [ "$SECURITY" = reality ] && [ "$FLOW" = xtls-rprx-vision ] &&
    [ "$TRANSPORT" = tcp ] && [ "$ENCRYPTION" = none ] || die 'Only VLESS / REALITY / Vision / TCP / encryption=none is supported.'
  [ "$FP" = chrome ] || die 'This profile converter expects fp=chrome.'
  [[ "$PBK" =~ ^[A-Za-z0-9_-]{43}$ ]] || die 'Invalid REALITY public key encoding.'
  [[ "$SID" =~ ^[A-Fa-f0-9]{0,16}$ ]] && [ $((${#SID}%2)) -eq 0 ] || die 'Invalid REALITY short ID.'
  case "$seen" in *'|sid|'*) ;; *) die 'REALITY sid is required (may be empty).';; esac
  [[ "$SNI" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] && [ "${#SNI}" -le 253 ] || die 'Invalid SNI.'
  # sing-box REALITY does not expose Xray spiderX. Do not invent a JSON field.
  [ "$SPX" = 0 ] || say 'NOTE: spx/spiderX is not mapped; successful REALITY connection must be tested.'
  unset VALUE u
}

sha256_file() {
  local out
  out=$(openssl dgst -sha256 "$1") || return 1
  HASH=${out##* }
  [[ "$HASH" =~ ^[0-9a-fA-F]{64}$ ]]
}
secure_state() {
  [ -d "$STATE" ] && [ ! -L "$STATE" ] || die 'Runtime directory missing or unsafe.'
  [ "$(stat -f '%u:%Lp' "$STATE")" = '0:700' ] || die 'Runtime directory must be root-owned, mode 700.'
}
safe_file() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -f '%u' "$1")" = 0 ]; }
read_saved() { safe_file "$STATE/$1" && IFS= read -r "$2" < "$STATE/$1"; }
need_tools() {
  local x missing=0
  for x in sw_vers sysctl curl openssl tar stat awk mkdir cp mv chmod ps sleep route ifconfig scutil tail cat grep rmdir; do
    command -v "$x" >/dev/null 2>&1 || { say "MISSING_TOOL=$x"; missing=1; }
  done
  [ "$missing" = 0 ] || die 'Required tools missing. No automatic installation.'
}
current_nic() {
  local result
  result=$(route -n get default 2>/dev/null) || return 1
  NIC=$(printf '%s\n' "$result" | awk '$1=="interface:" {print $2; exit}')
  [[ "$NIC" =~ ^en[0-9]+$ ]]
}
no_other_proxy() {
  local out
  out=$(scutil --proxy) || die 'Cannot inspect existing proxies.'
  if printf '%s\n' "$out" | awk '$1 ~ /^(HTTPEnable|HTTPSEnable|SOCKSEnable|ProxyAutoConfigEnable|ProxyAutoDiscoveryEnable)$/ && $3==1 {found=1} END{exit !found}'; then
    die 'An existing system proxy/PAC is enabled. Stop the old proxy first; do not combine them.'
  fi
}
owned_process() {
  local cmd
  [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -gt 1 ] || return 1
  cmd=$(ps -p "$1" -o command= 2>/dev/null) || return 1
  case "$cmd" in "$BIN run -c $STATE/"*) return 0;; *) return 1;; esac
}
stop_pid() {
  local n p=$1
  owned_process "$p" || return 0
  kill -TERM "$p" || return 1
  for ((n=0;n<15;n++)); do
    owned_process "$p" || { wait "$p" 2>/dev/null || :; return 0; }
    sleep 1
  done
  return 1
}
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$OWN_PID" ]; then
    stop_pid "$OWN_PID" || { say 'WARNING: core did not stop. No SIGKILL or route reset attempted.'; rc=1; }
  fi
  if [ "$LOCKED" = 1 ]; then rmdir "$STATE/operation.lock" 2>/dev/null || :; fi
  exit "$rc"
}
operation_lock() {
  mkdir "$STATE/operation.lock" 2>/dev/null || die 'Another helper operation or stale lock exists. Do not run concurrently.'
  LOCKED=1; trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM HUP
}
ensure_stopped() {
  local old
  if read_saved pid old; then
    if owned_process "$old"; then die 'Our core is already running. Use status/stop, not a second copy.'; fi
    if kill -0 "$old" 2>/dev/null; then die 'Saved PID belongs to another process; inspect state first.'; fi
  fi
}
get_core() {
  local found= candidate
  if safe_file "$BIN" && read_saved binary.sha256 found; then
    sha256_file "$BIN" && [ "$HASH" = "$found" ] || die 'Cached binary checksum changed.'
  else
    say 'Downloading official legacy Intel core (~26 MB); verifying pinned SHA-256.'
    curl -q -fL --connect-timeout 20 --max-time 900 --retry 2 \
      "https://github.com/SagerNet/sing-box/releases/download/v$CORE_VERSION/$ASSET" -o "$STATE/core.tgz.part" || die 'Download failed. Core was not executed.'
    sha256_file "$STATE/core.tgz.part" && [ "$HASH" = "$ASSET_SHA" ] || die 'Archive SHA-256 mismatch. Nothing executed.'
    mv "$STATE/core.tgz.part" "$STATE/core.tgz" || die 'Cannot save archive.'
    mkdir "$STATE/unpack" 2>/dev/null || die 'Unpack directory exists; inspect prior failed download.'
    tar -xzf "$STATE/core.tgz" -C "$STATE/unpack" || die 'Archive extraction failed.'
    found=
    for candidate in "$STATE"/unpack/sing-box "$STATE"/unpack/*/sing-box; do
      [ -f "$candidate" ] && [ ! -L "$candidate" ] || continue
      [ -z "$found" ] || die 'Archive has multiple client executables.'
      found=$candidate
    done
    [ -n "$found" ] || die 'Client missing from archive.'
    cp "$found" "$BIN" && chmod 700 "$BIN" || die 'Cannot prepare client.'
    sha256_file "$BIN" || die 'Cannot hash client.'
    printf '%s\n' "$HASH" > "$STATE/binary.sha256" || die 'Cannot save binary checksum.'
  fi
  "$BIN" version > "$STATE/version.log" 2>&1 || die 'Legacy core cannot run in this Recovery; inspect version.log.'
  cat "$STATE/version.log"
  grep -Fq "sing-box version $CORE_VERSION" "$STATE/version.log" || die 'Unexpected client version.'
}
write_configs() {
  local mode inbound config
  for mode in probe tun; do
    if [ "$mode" = probe ]; then
      inbound="{\"type\":\"mixed\",\"tag\":\"local-test\",\"listen\":\"127.0.0.1\",\"listen_port\":$LOCAL_PORT}"
    else
      inbound="{\"type\":\"tun\",\"tag\":\"recovery-tun\",\"interface_name\":\"$TUN\",\"address\":[\"172.19.0.1/30\",\"fdfe:dcba:9876::1/126\"],\"mtu\":1400,\"auto_route\":true,\"dns_mode\":\"hijack\",\"stack\":\"system\"}"
    fi
    config="$STATE/$mode.json"
    cat > "$config" <<EOF
{
  "log": {"level":"warn","timestamp":true},
  "dns": {
    "servers":[
      {"type":"udp","tag":"bootstrap","server":"$BOOTSTRAP","detour":"direct"},
      {"type":"https","tag":"remote-dns","server":"1.1.1.1","server_port":443,"path":"/dns-query","tls":{"enabled":true,"server_name":"cloudflare-dns.com"},"detour":"proxy"}
    ],
    "final":"remote-dns","strategy":"prefer_ipv4"
  },
  "inbounds": [$inbound],
  "outbounds": [
    {"type":"vless","tag":"proxy","server":"$HOST","server_port":$PORT,
     "uuid":"$UUID","flow":"xtls-rprx-vision","packet_encoding":"xudp",
     "domain_resolver":{"server":"bootstrap","strategy":"ipv4_only"},
     "tls":{"enabled":true,"server_name":"$SNI","utls":{"enabled":true,"fingerprint":"chrome"},"reality":{"enabled":true,"public_key":"$PBK","short_id":"$SID"}}},
    {"type":"direct","tag":"direct"}
  ],
  "route":{"default_interface":"$NIC","default_domain_resolver":"remote-dns",
    "rules":[{"port":53,"action":"hijack-dns"}],"final":"proxy"}
}
EOF
    [ "$?" = 0 ] && chmod 600 "$config" || die 'Cannot write private configuration.'
    "$BIN" check -c "$config" > "$STATE/check-$mode.log" 2>&1 || die "Configuration rejected. Inspect check-$mode.log; no network routes changed."
  done
  printf '%s\n' "$NIC" > "$STATE/interface" || die 'Cannot save interface.'
  unset UUID PBK SID SNI HOST PORT URI
}
launch_core() {
  local mode=$1 n
  ( trap - EXIT INT TERM; trap '' HUP; export GOMAXPROCS=2; exec "$BIN" run -c "$STATE/$mode.json" ) \
    </dev/null > "$STATE/$mode.log" 2>&1 &
  OWN_PID=$!; disown "$OWN_PID" 2>/dev/null || :
  printf '%s\n' "$OWN_PID" > "$STATE/pid" || die 'Cannot save core PID.'
  printf '%s\n' "$mode" > "$STATE/mode" || die 'Cannot save mode.'
  sleep 3
  owned_process "$OWN_PID" || die "Core exited. Inspect $mode.log."
}
probe_config() {
  local code rc
  launch_core probe
  code=$(curl -q -sS -I --noproxy '' --socks5-hostname "127.0.0.1:$LOCAL_PORT" \
    --connect-timeout 15 --max-time 45 -o /dev/null -w '%{http_code}' https://www.apple.com/ 2> "$STATE/probe-curl.log")
  rc=$?
  printf 'VLESS_TEST: curl=%s HTTP=%s\n' "$rc" "$code"
  [ "$rc" = 0 ] || die 'VLESS connection test failed. No TUN routes were enabled.'
  case "$code" in 2??|3??) ;; *) die 'Test returned an HTTP error. No TUN routes were enabled.';; esac
  owned_process "$OWN_PID" || die 'Core exited during test.'
  stop_pid "$OWN_PID" || die 'Probe core failed to stop; no TUN start.'
  OWN_PID=
  sha256_file "$STATE/tun.json" || die 'Cannot fingerprint tested configuration.'
  printf '%s\n' "$HASH" > "$STATE/probe.ok" || die 'Cannot record successful probe.'
  say 'VLESS_TEST_OK: one HTTPS endpoint tested. System routes/proxies/DNS unchanged by this test.'
  say 'Does NOT prove every Apple installation package is reachable.'
}
prepare() {
  local file=${1:-} result bootstrap
  no_other_proxy; current_nic || die 'No normal en* default interface. No auto-guess.'
  get_core
  result=$(scutil --dns) || die 'Cannot read current DNS.'
  bootstrap=$(printf '%s\n' "$result" | awk '$1=="nameserver[0]" && $2==":" && $3 ~ /^[0-9.]+$/ {print $3; exit}')
  [[ "$bootstrap" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die 'No IPv4 bootstrap resolver found. Do not change DNS blindly.'
  case "$bootstrap" in 127.*|0.*|172.19.0.*) die 'Bootstrap resolver is local/stale; cannot safely construct this tunnel.';; esac
  BOOTSTRAP=$bootstrap
  if [ -n "$file" ]; then
    [ -f "$file" ] && [ ! -L "$file" ] || die 'URI file missing/unsafe.'
    IFS= read -r URI < "$file" || [ -n "$URI" ] || die 'Empty URI file.'
  else
    printf 'Paste VLESS URI (hidden; not saved in shell history), then Enter: '
    IFS= read -rs URI || die 'Interactive input unavailable. Supply a local URI file instead.'
    printf '\n'
  fi
  parse_uri "$URI"; unset URI
  write_configs
  probe_config
  say 'PREPARED. Do not start TUN until the probe result has been reviewed.'
}
route_interface() {
  local result
  case "$1" in
    *:*) result=$(route -n get -inet6 "$1" 2>/dev/null) || return 1;;
    *) result=$(route -n get -inet "$1" 2>/dev/null) || return 1;;
  esac
  printf '%s\n' "$result" | awk '$1=="interface:" {print $2; exit}'
}
start_tun() {
  local expected saved answer n code rc
  safe_file "$STATE/tun.json" && read_saved probe.ok expected || die 'Run prepare and obtain VLESS_TEST_OK first.'
  sha256_file "$STATE/tun.json" && [ "$HASH" = "$expected" ] || die 'Configuration differs from the tested one. Prepare again.'
  no_other_proxy; current_nic || die 'Cannot determine current physical interface.'
  read_saved interface saved && [ "$NIC" = "$saved" ] || die 'Network interface changed. Prepare again.'
  if ifconfig "$TUN" >/dev/null 2>&1; then die 'Chosen utun interface already exists; do not replace it.'; fi
  get_core
  say 'TUN START is experimental on Recovery and changes IPv4/IPv6 routes and native DNS.'
  say 'Internet TCP/UDP follows VLESS, except local/specific routes and bootstrap/control traffic.'
  say 'No kill switch, no reboot persistence, no guaranteed protection from freezes.'
  printf 'Type TUN to enable (anything else cancels): '; IFS= read -r answer || exit 0
  [ "$answer" = TUN ] || exit 0
  scutil --dns > "$STATE/dns-before.txt" || die 'Cannot save DNS diagnostics.'
  route -n get default > "$STATE/route-before.txt" || die 'Cannot save route diagnostics.'
  launch_core tun
  for ((n=0;n<15;n++)); do
    owned_process "$OWN_PID" || die 'TUN core exited; inspect tun.log.'
    [ "$(route_interface 1.1.1.1)" != "$TUN" ] || break
    sleep 1
  done
  [ "$(route_interface 1.1.1.1)" = "$TUN" ] || die 'IPv4 test destination does not use our TUN.'
  [ "$(route_interface 2606:4700:4700::1111)" = "$TUN" ] || die 'IPv6 test destination does not use our TUN.'
  code=$(curl -q -4 -sS -I --proxy '' --noproxy '*' --connect-timeout 15 --max-time 45 \
    -o /dev/null -w '%{http_code}' https://www.apple.com/ 2> "$STATE/tun-curl.log")
  rc=$?; printf 'TUN_TEST: curl=%s HTTP=%s\n' "$rc" "$code"
  [ "$rc" = 0 ] || die 'HTTPS/DNS test through TUN failed; stopping our core.'
  case "$code" in 2??|3??) ;; *) die 'Apple test returned HTTP error; stopping our core.';; esac
  say 'TUN_READY: sample routes and one IPv4 HTTPS request succeeded. Not proof of all-traffic coverage.'
  say 'Core continues in background in this Recovery session only. No automatic reconnect/restart.'
  say 'Stop: bash /tmp/vless.sh stop'
  OWN_PID=
}
stop_core() {
  local p
  read_saved pid p || die 'No saved core PID.'
  if owned_process "$p"; then stop_pid "$p" || die 'Core did not stop. No forced kill attempted.'; fi
  if ifconfig "$TUN" >/dev/null 2>&1; then
    die 'utun19 still exists. Review routes/DNS; do not delete an interface by guessing.'
  fi
  say 'CORE_STOPPED. Native sing-box cleanup requested; direct internet may resume.'
  say 'This is not a kill switch. Compare saved DNS diagnostics if connectivity is abnormal.'
}
main() {
  set +x
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077; set -o pipefail; ulimit -c 0 2>/dev/null || :
  [ "${1:-}" != --version ] || { say "VLESS RECOVERY $VERSION"; return; }
  [ "$EUID" = 0 ] || die 'Run as root in Recovery.'
  need_tools
  case "$(sw_vers -productName)" in 'Mac OS X'|macOS) ;; *) die 'macOS required.';; esac
  [ "$(sysctl -n hw.machine)" = x86_64 ] || die 'This helper is for Intel macOS only.'
  if [ ! -e "$STATE" ] && [ ! -L "$STATE" ]; then mkdir -m 700 "$STATE" || die 'Cannot create runtime state.'; fi
  secure_state
  say "VLESS RECOVERY $VERSION — experimental, not tested on real Recovery."
  case "${1:-prepare}" in
    status)
      local p
      if read_saved pid p && owned_process "$p"; then say "CORE_RUNNING PID=$p"; else say CORE_NOT_RUNNING; fi
      say "LOGS=$STATE (contains private config; do not publish it)";;
    stop) operation_lock; stop_core;;
    prepare) [ "$#" -le 2 ] || die 'Provide exactly one URI file.'; operation_lock; ensure_stopped; prepare "${2:-}";;
    start) operation_lock; ensure_stopped; start_tun;;
    *) die 'Usage: bash vless.sh [prepare [local-link-file]|start|status|stop|--version]';;
  esac
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
