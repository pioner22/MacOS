#!/bin/bash
# A1398 / full Intel macOS 10.15+: private VLESS/REALITY client + Catalina download.
# Not Recovery. Not a system VPN: no TUN, DNS, firewall, hosts, or proxy setting writes.
# No personal URI in this public file. Run as the normal user, WITHOUT sudo.
VERSION=1.0.0
CORE_VERSION=1.14.0
ASSET=sing-box-1.14.0-darwin-amd64-legacy-macos-10.13.tar.gz
ASSET_SHA=99285bb2d30739dc8884144cf90f50538336eab9914ac4524290f5b82fdb5565
DL_REF=fcf65e639269e1259c64d8aa46a43bd63da134c7
DL_SHA=2e86bca5dc16d594ff70afb3e7bfed5a6f65b0e167e0c64e8de88798c08fb7de
BASE=
RUN=
BIN=
CONFIG=
CORE_PID=
DL_PID=
WAKE_PID=
LOCKED=0
URI_FILE=
LOCAL_ARCHIVE=
RECONFIGURE=0
LOCAL_PORT=2080
CURL=/usr/bin/curl
SHASUM=/usr/bin/shasum
BOOTSTRAP=(-q -4 -fL --proto '=https' --proto-redir '=https' -x '' --noproxy '*' --connect-timeout 20 --max-time 1800 --speed-time 120 --speed-limit 1024)

say() { printf '%s\n' "$*"; }
die() { say "STOP: $*" >&2; exit 1; }
hash_file() {
  local out
  HASH=
  out=$("$SHASUM" -a 256 < "$1") || return 1
  HASH=${out%% *}
  [[ "$HASH" =~ ^[a-f0-9]{64}$ ]]
}
owned_file() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -f '%u' "$1")" = "$EUID" ]; }
private_dir() {
  [ ! -L "$1" ] || die 'Unsafe directory symlink.'
  [ -d "$1" ] || mkdir -m 700 "$1" || die 'Cannot create private directory.'
  [ "$(stat -f '%u' "$1")" = "$EUID" ] || die 'Directory belongs to another user.'
  chmod 700 "$1" || die 'Cannot restrict directory permissions.'
}
lock_base() {
  local old
  [ ! -L "$BASE/lock" ] || die 'Unsafe lock path.'
  if ! mkdir "$BASE/lock" 2>/dev/null; then
    owned_file "$BASE/lock/pid" || die 'Unknown lock. Inspect it before retrying.'
    IFS= read -r old < "$BASE/lock/pid"
    [[ "$old" =~ ^[0-9]+$ ]] && [ "$old" -gt 1 ] || die 'Invalid lock PID.'
    kill -0 "$old" 2>/dev/null && die 'A previous wrapper process is still running.'
    rm "$BASE/lock/pid" && rmdir "$BASE/lock" && mkdir "$BASE/lock" || die 'Cannot recover stale lock.'
  fi
  LOCKED=1
  printf '%s\n' "$$" > "$BASE/lock/pid" || die 'Cannot write lock PID.'
}
core_alive() {
  local cmd
  [ -n "$CORE_PID" ] && kill -0 "$CORE_PID" 2>/dev/null || return 1
  cmd=$(ps -ww -p "$CORE_PID" -o command=) || return 1
  case "$cmd" in "$BIN run -c $CONFIG"*) return 0;; *) return 1;; esac
}
cleanup() {
  local rc=$? n
  trap - EXIT INT TERM HUP
  # Stop the proxy first: any remaining downloader connection fails, not bypasses.
  if core_alive; then
    kill -TERM "$CORE_PID" 2>/dev/null || :
    for ((n=0;n<10;n++)); do core_alive || break; sleep 1; done
    if core_alive; then say 'WARNING: client did not stop; inspect the session. No forced kill.'; else wait "$CORE_PID" 2>/dev/null || :; fi
  fi
  if [ -n "$DL_PID" ] && kill -0 "$DL_PID" 2>/dev/null; then
    kill -TERM "$DL_PID" 2>/dev/null || :
    for ((n=0;n<10;n++)); do kill -0 "$DL_PID" 2>/dev/null || break; sleep 1; done
  fi
  if [ -n "$WAKE_PID" ]; then kill "$WAKE_PID" 2>/dev/null || :; wait "$WAKE_PID" 2>/dev/null || :; fi
  if [ "$LOCKED" = 1 ]; then rm -f "$BASE/lock/pid"; rmdir "$BASE/lock" 2>/dev/null || :; fi
  [ -z "$RUN" ] || say "CLIENT_LOGS=$RUN (private; do not publish profile.uri or client.json)"
  say 'Client session finished. No system network settings were changed.'
  exit "$rc"
}
fetch_checked() {
  local url=$1 target=$2 expected=$3
  [ ! -L "$target" ] && [ ! -L "$target.part" ] || die 'Unsafe bootstrap file path.'
  "$CURL" "${BOOTSTRAP[@]}" "$url" -o "$target.part" || die 'Bootstrap download failed. No unchecked code executed.'
  hash_file "$target.part" && [ "$HASH" = "$expected" ] || die 'Bootstrap SHA-256 mismatch; nothing executed.'
  mv "$target.part" "$target" || die 'Cannot finalize bootstrap download.'
}
prepare_core() {
  local archive="$BASE/$ASSET" member count
  if [ -n "$LOCAL_ARCHIVE" ]; then
    [ -f "$LOCAL_ARCHIVE" ] && [ ! -L "$LOCAL_ARCHIVE" ] || die 'Local core archive is missing/unsafe.'
    archive=$LOCAL_ARCHIVE
  elif [ ! -e "$archive" ]; then
    say 'Downloading official sing-box legacy Intel build (~26 MB), before VPN is available.'
    fetch_checked "https://github.com/SagerNet/sing-box/releases/download/v$CORE_VERSION/$ASSET" "$archive" "$ASSET_SHA"
  else
    owned_file "$archive" || die 'Unsafe cached archive.'
  fi
  hash_file "$archive" && [ "$HASH" = "$ASSET_SHA" ] || die 'Core archive checksum differs from pinned official metadata.'
  tar -tzf "$archive" > "$RUN/archive-list.txt" || die 'Cannot list core archive.'
  count=0; member=
  while IFS= read -r name; do
    case "$name" in /*|../*|*/../*|*/..) die 'Unsafe archive path.';; esac
    case "$name" in sing-box|*/sing-box) member=$name; count=$((count+1));; esac
  done < "$RUN/archive-list.txt"
  [ "$count" = 1 ] || die 'Expected one client executable in official archive.'
  mkdir "$RUN/core" || die 'Cannot create extraction directory.'
  tar -xzf "$archive" -C "$RUN/core" "$member" || die 'Cannot extract client.'
  [ -f "$RUN/core/$member" ] && [ ! -L "$RUN/core/$member" ] || die 'Invalid client executable.'
  BIN="$RUN/sing-box"
  cp "$RUN/core/$member" "$BIN" && chmod 700 "$BIN" || die 'Cannot prepare client.'
  "$BIN" version > "$RUN/version.log" 2>&1 || die 'Client cannot execute on this Mac. Inspect version.log; do not disable macOS protection.'
  grep -Fxq "sing-box version $CORE_VERSION" "$RUN/version.log" || die 'Unexpected client version.'
  say "CORE_VERSION=$CORE_VERSION ARCHIVE_SHA256_OK"
}

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

read_uri() {
  local source=$1 extra
  [ -f "$source" ] && [ ! -L "$source" ] || die 'URI file missing or unsafe.'
  [ "$(stat -f '%z' "$source")" -le 8192 ] || die 'URI file is unexpectedly large.'
  URI=
  { IFS= read -r URI || [ -n "$URI" ] || die 'URI file is empty.'
    # Permit a CRLF ending, but reject a second nonempty line.
    URI=${URI%$'\r'}
    while IFS= read -r extra || [ -n "$extra" ]; do
      [ -z "${extra%$'\r'}" ] || die 'URI file contains more than one line.'
    done
  } < "$source"
}
get_profile() {
  local saved="$BASE/profile.uri"
  if [ -n "$URI_FILE" ]; then
    read_uri "$URI_FILE"
  elif [ "$RECONFIGURE" = 0 ] && [ -e "$saved" ]; then
    owned_file "$saved" || die 'Unsafe saved URI.'
    chmod 600 "$saved" || die 'Cannot protect saved URI.'
    say 'Using the saved private VLESS profile (no credential displayed).'
    read_uri "$saved"
  else
    say 'Paste your VLESS URI at the hidden prompt. It is saved only locally, mode 600.'
    printf 'VLESS URI: '
    IFS= read -rs URI || die 'No interactive input. Use --uri-file PATH instead.'
    printf '\n'
    URI=${URI%$'\r'}
  fi
  parse_uri "$URI"
  [ ! -L "$saved" ] || die 'Unsafe saved URI path.'
  printf '%s\n' "$URI" > "$RUN/profile.new" && chmod 600 "$RUN/profile.new" && mv "$RUN/profile.new" "$saved" || die 'Cannot store private profile.'
  unset URI VALUE
}
choose_port() {
  local n
  for ((n=2080;n<=2090;n++)); do
    if ! /usr/sbin/lsof -nP -iTCP:"$n" -sTCP:LISTEN >/dev/null 2>&1; then LOCAL_PORT=$n; return; fi
  done
  die 'Ports 2080..2090 are occupied. No existing process was stopped.'
}
write_config() {
  CONFIG="$RUN/client.json"
  cat > "$CONFIG" <<EOF
{
  "log":{"level":"warn","timestamp":true},
  "dns":{"servers":[{"type":"local","tag":"bootstrap"}]},
  "inbounds":[{"type":"mixed","tag":"download-only","listen":"127.0.0.1","listen_port":$LOCAL_PORT,"set_system_proxy":false}],
  "outbounds":[{
    "type":"vless","tag":"vpn","server":"$HOST","server_port":$PORT,
    "uuid":"$UUID","flow":"xtls-rprx-vision","network":"tcp",
    "domain_resolver":{"server":"bootstrap","strategy":"ipv4_only"},
    "tls":{"enabled":true,"server_name":"$SNI",
      "utls":{"enabled":true,"fingerprint":"chrome"},
      "reality":{"enabled":true,"public_key":"$PBK","short_id":"$SID"}}
  }],
  "route":{"final":"vpn"}
}
EOF
  [ "$?" = 0 ] && chmod 600 "$CONFIG" || die 'Cannot create private client config.'
  unset UUID PBK SID SNI HOST PORT
  "$BIN" check -c "$CONFIG" > "$RUN/check.log" 2>&1 || die 'Client rejected config. Inspect check.log privately; no routing was changed.'
}
start_client() {
  local n ready=0 code rc
  (export GOMAXPROCS=2; exec "$BIN" run -c "$CONFIG") < /dev/null > "$RUN/client.log" 2>&1 &
  CORE_PID=$!
  for ((n=0;n<10;n++)); do
    core_alive || { sleep 1; core_alive || die 'Client exited. Inspect client.log.'; }
    if /usr/sbin/lsof -a -p "$CORE_PID" -nP -iTCP:"$LOCAL_PORT" -sTCP:LISTEN >/dev/null 2>&1; then ready=1; break; fi
    sleep 1
  done
  [ "$ready" = 1 ] || die 'Client did not open its local port.'
  code=$("$CURL" -q -sS -fIL --proto '=https' --proto-redir '=https' --proxy "socks5h://127.0.0.1:$LOCAL_PORT" --noproxy '' \
    --connect-timeout 15 --max-time 45 -o /dev/null -w '%{http_code}' https://www.apple.com/ 2> "$RUN/probe.log")
  rc=$?; say "VLESS_TEST: curl=$rc HTTP=$code"
  [ "$rc" = 0 ] && [[ "$code" =~ ^[23][0-9][0-9]$ ]] && core_alive || die 'VLESS test failed. Download will NOT fall back to direct access.'
  say 'VLESS_TEST_OK: one Apple HTTPS request succeeded through this client; package download not yet tested.'
}
main() {
  set +x
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077; ulimit -c 0 2>/dev/null || :
  set -o pipefail
  local tool os major minor archive= endpoint rc
  OUTPUT="$HOME/macOS-rescue/Catalina-001-68446-VLESS"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --uri-file) [ "$#" -ge 2 ] || die 'Missing URI filename.'; URI_FILE=$2; shift 2;;
      --core-archive) [ "$#" -ge 2 ] || die 'Missing archive filename.'; LOCAL_ARCHIVE=$2; shift 2;;
      --output) [ "$#" -ge 2 ] || die 'Missing output directory.'; OUTPUT=$2; shift 2;;
      --reconfigure) RECONFIGURE=1; shift;;
      --help|-h) say 'bash download-vpn.sh [--uri-file PATH] [--reconfigure] [--core-archive PATH] [--output ABSOLUTE_PATH]'; return 0;;
      *) die 'Unknown option. Do not pass a secret URI in command-line arguments.';;
    esac
  done
  [ "$EUID" != 0 ] || die 'Run on the working A1398 as a normal macOS user, WITHOUT sudo; not Recovery.'
  for tool in "$CURL" "$SHASUM" /usr/bin/sw_vers /usr/sbin/sysctl /usr/bin/stat /usr/sbin/lsof /usr/bin/caffeinate /usr/bin/tar; do
    [ -x "$tool" ] || die "Required tool missing: $tool (no Homebrew install attempted)."
  done
  for tool in mkdir chmod cp mv rm rmdir ps grep mktemp sleep cat; do command -v "$tool" >/dev/null || die "Missing tool: $tool"; done
  os=$(/usr/bin/sw_vers -productVersion) || die 'Cannot identify macOS.'
  major=${os%%.*}; minor=${os#*.}; minor=${minor%%.*}
  [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] || die 'Invalid macOS version.'
  [ "$major" -gt 10 ] || { [ "$major" = 10 ] && [ "$minor" -ge 15 ]; } || die 'Requires full macOS 10.15 or newer.'
  [ "$(/usr/sbin/sysctl -n hw.machine)" = x86_64 ] || die 'This build is for Intel x86_64 only.'
  case "$OUTPUT" in /*) ;; *) die 'Output must be an absolute path.';; esac
  [ ! -L "$HOME/macOS-rescue" ] || die 'macOS-rescue must not be a symlink.'
  [ -d "$HOME/macOS-rescue" ] || mkdir -m 700 "$HOME/macOS-rescue" || die 'Cannot create working directory.'
  BASE="$HOME/macOS-rescue/.vless-client"
  private_dir "$BASE"
  BASE=$(cd "$BASE" && pwd -P) || die 'Cannot resolve working directory.'
  trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM HUP
  lock_base
  RUN=$(mktemp -d "$BASE/session.XXXXXX") || die 'Cannot create session directory.'
  say "CATALINA VIA VLESS $VERSION | macOS=$os"
  say 'This installs a per-user client, not a system-wide VPN. No sudo, TUN or DNS changes.'
  say 'GitHub bootstrap and DNS of the VLESS server use the current network; Apple download uses VLESS.'
  /usr/bin/caffeinate -is -w $$ > "$RUN/caffeinate.log" 2>&1 &
  WAKE_PID=$!
  sleep 1; kill -0 "$WAKE_PID" 2>/dev/null || die 'caffeinate did not start.'
  prepare_core
  fetch_checked "https://raw.githubusercontent.com/pioner22/MacOS/$DL_REF/download-catalina.sh" "$RUN/download-catalina.sh" "$DL_SHA"
  /bin/bash -n "$RUN/download-catalina.sh" || die 'Downloader syntax check failed.'
  get_profile; choose_port; write_config; start_client
  say 'Starting the original Catalina file download THROUGH VLESS. Keep this Terminal window open.'
  /bin/bash "$RUN/download-catalina.sh" --socks5 "127.0.0.1:$LOCAL_PORT" --output "$OUTPUT" &
  DL_PID=$!
  wait "$DL_PID"; rc=$?; DL_PID=
  say "DOWNLOADER_EXIT=$rc"
  [ "$rc" = 0 ] || die 'Download or verification failed; files/logs retained. No direct retry.'
  say "DONE: review the package verification log in $OUTPUT/logs before using the file."
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
