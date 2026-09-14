#!/bin/bash
# Recovery SSH web proxy 1.0.3. Bash 3.2, macOS Recovery / macOS.
# NOT a VPN, transparent tunnel, kill switch, or preboot proxy.
# Runtime network settings only; no disk repair/erasure, SIP/T2 changes,
# firewall changes, remote package installation or stored SSH passwords.
# Requires local ssh/curl/scutil and Python 3 on the SSH server.

VERSION=1.0.3
DEFAULT_SSH_HOST=87.251.87.17
DEFAULT_SSH_USER=admin
STATE=/private/tmp/mac-ssh-proxy
SOCKS_PORT=1080
HTTP_PORT=18080
GLOBAL_KEY=State:/Network/Global/Proxies
export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
umask 077

say() { printf '%s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 5 ]; }
port_ok() { uint "$1" && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ]; }
host_ok() { case "$1" in ''|[!a-zA-Z0-9]*|*[!a-zA-Z0-9.:-]*) return 1;; esac; [ "${#1}" -le 253 ]; }
user_ok() { case "$1" in ''|[!a-zA-Z0-9_]*|*[!a-zA-Z0-9_.-]*) return 1;; esac; [ "${#1}" -le 64 ]; }
read_value() { IFS= read -r "$2" < "$STATE/$1"; }
secure_state() {
  [ -d "$STATE" ] && [ ! -L "$STATE" ] || die 'No safe runtime directory. Run start.'
  [ "$(stat -f '%u:%Lp' "$STATE")" = '0:700' ] || die 'Unsafe runtime owner or permissions.'
}
load_config() {
  secure_state
  read_value host HOST && host_ok "$HOST" || die 'Invalid saved server.'
  read_value port PORT && port_ok "$PORT" || die 'Invalid saved port.'
  read_value user LOGIN && user_ok "$LOGIN" || die 'Invalid saved login.'
  read_value token TOKEN || die 'Missing runtime token.'
  case "$TOKEN" in ''|*[!a-zA-Z0-9_.-]*) die 'Invalid runtime token.';; esac
  read_value service SERVICE || die 'Missing network service.'
  case "$SERVICE" in ''|*[!a-zA-Z0-9-]*) die 'Invalid network service.';; esac
}
ctl() { ssh -F /dev/null -S "$STATE/control" -p "$PORT" -l "$LOGIN" -O "$1" "$HOST"; }
remote() {
  # ProxyCommand=false prevents a fresh fallback connection if multiplexing fails.
  ssh -F /dev/null -S "$STATE/control" -o ControlMaster=no -o BatchMode=yes \
    -o ProxyCommand=false -o ConnectTimeout=15 -T -p "$PORT" -l "$LOGIN" "$HOST" "$@"
}
primary_service() {
  local out result
  out=$(printf 'show State:/Network/Global/IPv4\nquit\n' | scutil) || return 1
  result=$(printf '%s\n' "$out" | awk '$1=="PrimaryService" && $2==":" {print $3; exit}')
  if [ -z "$result" ]; then
    out=$(printf 'show State:/Network/Global/IPv6\nquit\n' | scutil) || return 1
    result=$(printf '%s\n' "$out" | awk '$1=="PrimaryService" && $2==":" {print $3; exit}')
  fi
  case "$result" in ''|*[!a-zA-Z0-9-]*) return 1;; esac
  printf '%s\n' "$result"
}
sc_show() { printf 'show %s\nquit\n' "$1" | scutil; }
backup_key() {
  local key=$1 n=$2 value backup
  value=$(sc_show "$key") || return 1
  printf '%s\n' "$key" > "$STATE/key.$n" || return 1
  backup="State:/MacSSHProxy/$TOKEN/Backup/$n"
  case "$value" in
    *'<dictionary>'*)
      printf 'get %s\nset %s\nquit\n' "$key" "$backup" | scutil > "$STATE/scutil.log" 2>&1
      [ "$(sc_show "$backup")" = "$value" ] || return 1
      printf 'present\n' > "$STATE/had.$n" ;;
    *'No such key'*) printf 'absent\n' > "$STATE/had.$n" ;;
    *) return 1;;
  esac
  printf '%s\n' "$value" > "$STATE/original.$n.txt"
}
ours() { sc_show "$1" | awk -v t="$TOKEN" '$1=="MacSSHProxySession" && $2==":" && $3==t {found=1} END {exit !found}'; }
set_key() {
  local key=$1
  scutil > "$STATE/scutil.log" 2>&1 <<EOF
  d.init
  d.add HTTPEnable # 1
  d.add HTTPProxy 127.0.0.1
  d.add HTTPPort # $HTTP_PORT
  d.add HTTPSEnable # 1
  d.add HTTPSProxy 127.0.0.1
  d.add HTTPSPort # $HTTP_PORT
  d.add SOCKSEnable # 1
  d.add SOCKSProxy 127.0.0.1
  d.add SOCKSPort # $SOCKS_PORT
  d.add ProxyAutoConfigEnable # 0
  d.add ProxyAutoDiscoveryEnable # 0
  d.add ExcludeSimpleHostnames # 0
  d.add ExceptionsList * localhost 127.0.0.1 ::1
  d.add MacSSHProxySession $TOKEN
  set $key
  quit
EOF
  ours "$key"
}
apply_proxy() {
  local n key
  [ "$(primary_service)" = "$SERVICE" ] || return 1
  for n in 1 2; do
    read_value "key.$n" key || return 1
    ours "$key" || set_key "$key" || return 1
  done
  scutil --proxy > "$STATE/effective-proxy.txt" || return 1
  awk -v hp="$HTTP_PORT" -v sp="$SOCKS_PORT" '
    $1=="HTTPEnable" && $3==1 {h=1} $1=="HTTPPort" && $3==hp {hpok=1}
    $1=="HTTPSEnable" && $3==1 {s=1} $1=="SOCKSEnable" && $3==1 {k=1}
    $1=="SOCKSPort" && $3==sp {spok=1}
    END {exit !(h && hpok && s && k && spok)}' "$STATE/effective-proxy.txt"
}
restore_proxy() {
  local n key had backup value errors=0
  for n in 1 2; do
    [ -f "$STATE/had.$n" ] || continue
    read_value "key.$n" key && read_value "had.$n" had || { errors=1; continue; }
    # Restore only our dictionary, never a newer third-party configuration.
    ours "$key" || continue
    backup="State:/MacSSHProxy/$TOKEN/Backup/$n"
    if [ "$had" = present ]; then
      value=$(sc_show "$backup")
      case "$value" in *'<dictionary>'*) ;; *) errors=1; continue;; esac
      printf 'get %s\nset %s\nquit\n' "$backup" "$key" | scutil >> "$STATE/scutil.log" 2>&1
      [ "$(sc_show "$key")" = "$value" ] || errors=1
    elif [ "$had" = absent ]; then
      printf 'remove %s\nquit\n' "$key" | scutil >> "$STATE/scutil.log" 2>&1
      ours "$key" && errors=1
    else errors=1; fi
  done
  [ "$errors" = 0 ]
}
cleanup() {
  local rc=$? n restored=1
  trap - EXIT INT TERM
  if ! restore_proxy; then
    say 'WARNING: proxy rollback incomplete. Keep runtime logs; run stop again.'
    rc=1; restored=0
  fi
  ctl exit >> "$STATE/ssh.log" 2>&1 || :
  # The HTTP worker loses its SSH session; the remote bridge exits on broken stdout.
  if [ "$restored" = 1 ]; then
    for n in 1 2; do
      printf 'remove State:/MacSSHProxy/%s/Backup/%s\nquit\n' "$TOKEN" "$n" | scutil >> "$STATE/scutil.log" 2>&1
    done
  fi
  if [ "$rc" = 0 ]; then say STOPPED > "$STATE/status"; else say STOPPED_WITH_ERROR > "$STATE/status"; fi
  exit "$rc"
}
http_code() {
  local code=$1
  case "$code" in [1-5][0-9][0-9]) return 0;; *) return 1;; esac
}
probe() {
  local kind=$1 code rc args=()
  if [ "$kind" = socks ]; then args=(--socks5-hostname "127.0.0.1:$SOCKS_PORT")
  else args=(--proxy "http://127.0.0.1:$HTTP_PORT"); fi
  code=$(curl -q -sS --noproxy '' "${args[@]}" --connect-timeout 10 --max-time 30 \
    -I -o /dev/null -w '%{http_code}' https://www.apple.com/ 2> "$STATE/probe-$kind.log")
  rc=$?
  printf '%s probe: curl=%s HTTP=%s\n' "$kind" "$rc" "$code"
  [ "$rc" = 0 ] && http_code "$code" || return 1
  case "$code" in 2??|3??) ;; *) say 'WARNING: HTTP error response; tunnel responded, service availability NOT confirmed.';; esac
}
remote_python() {
  cat <<'MSP_PY'
# Transient, loopback-only HTTP/CONNECT bridge. Python 3 standard library.
# Launched inside an authenticated SSH session; no files/services are installed.
import http.server
import os
import select
import signal
import socket
import socketserver
import sys
import threading
import time
import urllib.parse


def relay(left, right):
    readers = [left, right]
    while readers:
        ready, _, _ = select.select(readers, [], [], 120)
        if not ready:
            raise TimeoutError("tunnel idle timeout")
        for src in ready:
            dst = right if src is left else left
            data = src.recv(65536)
            if data:
                dst.sendall(data)
            else:
                readers.remove(src)
                try:
                    dst.shutdown(socket.SHUT_WR)
                except OSError:
                    pass


class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    rbufsize = 0  # Do not prefetch bytes that belong to the tunnel/request body.
    timeout = 60

    def log_message(self, fmt, *args):
        pass  # Do not retain request URLs or authentication headers.

    def forward(self):
        upstream = None
        sent = False
        self.close_connection = True
        try:
            if self.command == "CONNECT":
                target = urllib.parse.urlsplit("//" + self.path)
                host, port = target.hostname, target.port or 443
                if target.path or target.query or target.fragment or target.username:
                    raise ValueError("invalid CONNECT target")
                first = None
            else:
                target = urllib.parse.urlsplit(self.path)
                if target.scheme.lower() != "http" or target.username or target.fragment:
                    raise ValueError("use absolute HTTP URI or CONNECT")
                host, port = target.hostname, target.port or 80
                first = (target.path or "/") + (("?" + target.query) if target.query else "")
            # Installer web traffic only. Arbitrary TCP remains available through SOCKS.
            if not host or port not in (80, 443):
                self.send_error(403, "Only web ports 80 and 443 are allowed")
                return
            upstream = socket.create_connection((host, port), timeout=20)
            upstream.settimeout(60)
            self.connection.settimeout(60)
            if first is None:
                self.send_response(200, "Connection established")
                self.end_headers()
                self.wfile.flush()
                sent = True
            else:
                forbidden = {"proxy-authorization", "proxy-connection", "connection", "keep-alive"}
                headers = []
                for key, value in self.headers.items():
                    if "\r" in value or "\n" in value:
                        raise ValueError("invalid header")
                    if key.lower() not in forbidden:
                        headers.append(key + ": " + value)
                if not self.headers.get("Host"):
                    headers.append("Host: " + target.netloc)
                request = self.command + " " + first + " HTTP/1.1\r\n"
                request += "\r\n".join(headers) + "\r\nConnection: close\r\n\r\n"
                upstream.sendall(request.encode("iso-8859-1"))
                sent = True
            relay(self.connection, upstream)
        except (OSError, ValueError, TimeoutError):
            if not sent:
                try:
                    self.send_error(502, "Upstream connection failed")
                except OSError:
                    pass
        finally:
            if upstream is not None:
                upstream.close()

    do_CONNECT = forward
    do_GET = forward
    do_HEAD = forward
    do_POST = forward
    do_PUT = forward
    do_OPTIONS = forward
    do_DELETE = forward
    do_PATCH = forward


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 64

    def __init__(self, *args):
        self.slots = threading.BoundedSemaphore(48)
        super().__init__(*args)

    def process_request(self, request, client_address):
        if not self.slots.acquire(False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    # A closed SSH output pipe ends this transient server within a heartbeat.
    if hasattr(signal, "SIGPIPE"):
        signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    server = Server(("127.0.0.1", 0), Proxy)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print("MSP_HTTP_PORT=" + str(server.server_address[1]), flush=True)
    deadline = time.monotonic() + 86400  # At most 24 hours per session.
    while time.monotonic() < deadline:
        time.sleep(5)
        print("MSP_ALIVE", flush=True)
    server.shutdown()
    server.server_close()


if __name__ == "__main__":
    main()
MSP_PY
}
worker() {
  load_config
  local code quoted
  code=$(remote_python) || exit 1
  quoted=${code//\'/\'\\\'\'}
  remote "PYTHONDONTWRITEBYTECODE=1 python3 -u -c '$quoted'"
}
watch() {
  load_config
  trap cleanup EXIT
  trap 'exit 0' TERM INT
  trap '' HUP
  say "$$" > "$STATE/watch.pid"
  apply_proxy || die 'System proxy application failed.'
  say RUNNING > "$STATE/status"
  while [ ! -e "$STATE/stop.request" ]; do
    sleep 5
    ctl check >> "$STATE/ssh.log" 2>&1 || die 'SSH disconnected. Restart requires authentication.'
    local pid
    read_value worker.pid pid || die 'HTTP worker PID missing.'
    kill -0 "$pid" 2>/dev/null || die 'HTTP forwarding session ended.'
    apply_proxy || die 'Network changed or temporary proxy state could not be maintained.'
  done
}
watch_alive() {
  local pid command
  read_value watch.pid pid 2>/dev/null || return 1
  case "$pid" in ''|*[!0-9]*) return 1;; esac
  command=$(ps -p "$pid" -o command= 2>/dev/null) || return 1
  case "$command" in *"$STATE/run.sh _watch"*) return 0;; *) return 1;; esac
}
status() {
  load_config
  cat "$STATE/status" 2>/dev/null || :
  ctl check 2>&1 || :
  if watch_alive; then say 'MONITOR=RUNNING'; else say 'MONITOR=NOT_RUNNING'; fi
  scutil --proxy
  say "LOGS=$STATE"
  say 'Not a VPN. Only proxy-aware connections. Does not survive a Mac reboot.'
}
stop_proxy() {
  load_config
  if watch_alive; then
    : > "$STATE/stop.request"
    local n
    for ((n=0;n<35;n++)); do watch_alive || break; sleep 1; done
    watch_alive && die 'Monitor did not stop. Do not kill unrelated processes; inspect daemon.log.'
  else
    trap cleanup EXIT
  fi
  say 'Stop requested. Previous runtime proxy dictionaries are restored when still owned by this tool.'
}
# Recovery can omit nohup. Ignore HUP before exec and detach all stdio.
# Do not inherit the starting shell's cleanup handler into the child.
# This survives an ordinary terminal hangup, not reboot or forced termination.
spawn_background() {
  local logfile=$1
  shift
  ( trap - EXIT INT TERM; trap '' HUP; exec "$@" ) < /dev/null >> "$logfile" 2>&1 &
  BACKGROUND_PID=$!
  disown "$BACKGROUND_PID" 2>/dev/null || :
}
check_tools() {
  local tool missing=0
  for tool in ssh curl scutil stat awk mkdir cp mv date cat chmod sleep ps; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'MISSING_TOOL=%s\n' "$tool" >&2
      missing=1
    fi
  done
  [ -x /bin/bash ] || { say 'MISSING_TOOL=/bin/bash' >&2; missing=1; }
  [ "$missing" = 0 ] || die 'Required tools are missing (listed above). No changes or package installation.'
}
start() {
  local t old service answer port_text n remoteport code workerpid self=${BASH_SOURCE[0]} archive=
  [ "$EUID" = 0 ] || die 'Run as root: sudo bash proxy.sh start (Recovery already uses root).'
  say "RECOVERY SSH WEB PROXY $VERSION"
  check_tools
  if [ -e "$STATE" ] || [ -L "$STATE" ]; then
    secure_state
    if [ -f "$STATE/status" ]; then
      read_value status old
      case "$old" in STOPPED) ;; *) die 'Existing session/state: run status, then stop. Do not run two tunnels.';; esac
    else die 'Incomplete prior setup. Inspect the runtime directory before retrying.'; fi
    archive="$STATE.old.$(date +%s).$$"
    mv "$STATE" "$archive" || die 'Cannot archive previous state.'
    case "$self" in "$STATE/"*) self="$archive/${self#"$STATE/"}";; esac
  fi
  SERVICE=$(primary_service) || die 'No active network service found. Connect Wi-Fi/Ethernet first.'
  say 'Background SOCKS + HTTP/CONNECT proxy, not all-traffic VPN or preboot networking.'
  say 'Server needs SSH TCP forwarding, remote command access and existing Python 3.'
  say 'A temporary loopback-only Python process runs on the server; no packages/config are installed.'
  say 'Runtime proxy settings are restored on stop/disconnect; direct traffic may then resume.'
  HOST=$DEFAULT_SSH_HOST
  LOGIN=$DEFAULT_SSH_USER
  host_ok "$HOST" && user_ok "$LOGIN" || die 'Invalid preset server or login.'
  printf 'SSH server: %s\nSSH login:  %s\n' "$HOST" "$LOGIN"
  printf 'SSH port [22]: '
  IFS= read -r PORT || die 'No interactive input. Run the script directly with bash.'
  PORT=${PORT:-22}; port_ok "$PORT" || die 'Invalid port.'
  PORT=$((10#$PORT))
  printf 'Enter 1 to connect and temporarily set system proxies: '
  IFS= read -r answer || die 'Confirmation input closed.'
  [ "$answer" = 1 ] || exit 0
  mkdir -m 700 "$STATE" || die 'Cannot create private runtime directory.'
  if [ -n "$archive" ] && [ -f "$archive/known_hosts" ] && [ ! -L "$archive/known_hosts" ]; then
    cp "$archive/known_hosts" "$STATE/known_hosts" || die 'Cannot preserve known host keys.'
  fi
  TOKEN="msp_$(date +%s)_$$"
  for t in host port user token service; do
    case "$t" in host) old=$HOST;; port) old=$PORT;; user) old=$LOGIN;; token) old=$TOKEN;; service) old=$SERVICE;; esac
    printf '%s\n' "$old" > "$STATE/$t" || die 'Cannot write runtime state.'
  done
  cp "$self" "$STATE/run.sh" && chmod 700 "$STATE/run.sh" || die 'Cannot copy runtime script.'
  say STARTING > "$STATE/status"
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  say 'Verify the SSH host-key fingerprint before accepting. Enter the password only in SSH.'
  ssh -F /dev/null -fNT -M -S "$STATE/control" -D "127.0.0.1:$SOCKS_PORT" \
    -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -o ConnectTimeout=20 -o StrictHostKeyChecking=ask -o ForwardAgent=no \
    -o PreferredAuthentications=keyboard-interactive,password,publickey \
    -o NumberOfPasswordPrompts=3 -o UserKnownHostsFile="$STATE/known_hosts" \
    -p "$PORT" -l "$LOGIN" "$HOST" || die 'SSH login/forwarding failed. No system proxies applied.'
  ctl check >> "$STATE/ssh.log" 2>&1 || die 'SSH master is not running.'
  remote 'command -v python3 >/dev/null && python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,6) else 1)"' \
    > "$STATE/python-check.log" 2>&1 || die 'Server Python 3.6+ unavailable (or remote command disabled). No automatic install.'
  spawn_background "$STATE/http-worker.log" /bin/bash "$STATE/run.sh" _worker
  workerpid=$BACKGROUND_PID; printf '%s\n' "$workerpid" > "$STATE/worker.pid"
  remoteport=
  for ((n=0;n<30;n++)); do
    remoteport=$(awk -F= '/^MSP_HTTP_PORT=[0-9]+$/ {print $2; exit}' "$STATE/http-worker.log")
    [ -z "$remoteport" ] || break
    kill -0 "$workerpid" 2>/dev/null || die 'Remote HTTP bridge failed. Inspect http-worker.log.'
    sleep 1
  done
  port_ok "$remoteport" || die 'Remote HTTP bridge did not report a valid port.'
  ssh -F /dev/null -S "$STATE/control" -O forward -L "127.0.0.1:$HTTP_PORT:127.0.0.1:$remoteport" \
    -o ExitOnForwardFailure=yes -p "$PORT" -l "$LOGIN" "$HOST" || die 'Local HTTP port/SSH forwarding failed.'
  probe socks && probe http || die 'Proxy test failed. See probe-*.log. No system proxies applied.'
  backup_key "State:/Network/Service/$SERVICE/Proxies" 1 || die 'Cannot snapshot service proxies.'
  backup_key "$GLOBAL_KEY" 2 || die 'Cannot snapshot global proxies.'
  apply_proxy || die 'Cannot confirm temporary system proxies.'
  spawn_background "$STATE/daemon.log" /bin/bash "$STATE/run.sh" _watch
  printf '%s\n' "$BACKGROUND_PID" > "$STATE/watch.pid"
  for ((n=0;n<20;n++)); do
    read_value status old
    [ "$old" != RUNNING ] || break
    watch_alive || die 'Background monitor failed. Inspect daemon.log.'
    sleep 1
  done
  [ "$old" = RUNNING ] || die 'Background monitor startup timed out.'
  trap - EXIT INT TERM HUP
  say 'PROXY_READY: SSH tunnel, HTTP bridge and temporary system proxy settings confirmed.'
  say 'Background jobs started without nohup; ordinary Terminal hangup is ignored.'
  say 'Return to the installer in this Recovery session; do not force-kill these processes.'
  say 'NOT all traffic: UDP/QUIC, some DNS and clients ignoring proxies can bypass this.'
  say 'Not persistent: Mac reboot/Internet Recovery globe stops this tunnel.'
  say 'A successful Apple HEAD test is NOT proof that every installation package is reachable.'
  say "Status: bash $STATE/run.sh status"
  say "Stop:   bash $STATE/run.sh stop"
  say "LOGS=$STATE"
}
is_macos() {
  # Recovery can contain sw_vers but omit uname. Neither tool is mandatory alone.
  local product=
  if command -v sw_vers >/dev/null 2>&1; then
    product=$(sw_vers -productName 2>/dev/null) || product=
    case "$product" in
      'Mac OS X'|'macOS'|'Mac OS X Server'|'macOS Server') return 0 ;;
    esac
  fi
  if command -v uname >/dev/null 2>&1; then
    [ "$(uname -s 2>/dev/null)" = Darwin ] && return 0
  fi
  return 1
}
main() {
  case "${1:-start}" in
    --version|version) say "RECOVERY SSH WEB PROXY $VERSION"; return 0 ;;
  esac
  is_macos || die 'This launcher requires macOS (sw_vers or uname); nothing changed.'
  [ "$EUID" = 0 ] || die 'Root is required. Recovery Terminal is already root.'
  case "${1:-start}" in
    start) start;; status) status;; stop) stop_proxy;;
    test) load_config; probe socks; probe http;;
    doctor) say "RECOVERY SSH WEB PROXY $VERSION"; check_tools; say 'LOCAL_TOOLS_OK (availability only; not an end-to-end test)';;
    _worker) worker;; _watch) watch;;
    *) say 'Usage: bash proxy.sh [start|status|test|stop|doctor|--version]'; return 2;;
  esac
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
