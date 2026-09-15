#!/bin/bash
# VLESS Recovery helper 0.1.2 (experimental). Bash 3.2, Intel macOS.
# Public file: no personal UUID, private URI, key or SSH credential.
# prepare: localhost-only test; start: explicit opt-in TUN routes and native DNS.
# No scutil write/reapply loop, pf changes, disk changes, TLS bypass or reboot service.
# Recovery compatibility is NOT established by the legacy binary's OS label.

VERSION=0.1.2
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

# SHA-256 is required; OpenSSL is not. Test an installed implementation before use.
# Feed bytes through stdin: no filename parsing/escaping or whole-file RAM buffering.
SHA256_BACKEND=
SHA256_TOOL=
# Self-contained fallback: core Perl only; no Digest::SHA, CPAN or downloads.
# Initial trust is the HTTPS-delivered script, exactly as for its shell code.
# Self-tests detect computation defects, not the authenticity of this script.
perl_core_sha256() {
  PERL5OPT= PERL5LIB= "$SHA256_TOOL" -e '
# Module-free streaming SHA-256, for checking small bootstrap archives/configs.
# FIPS 180-4 algorithm; not a validated cryptographic module. No Perl .pm/XS files.
# Capped at 256 MiB: do not use this slow fallback to hash a macOS installer.
BEGIN { @INC = (); }
my @K = map { hex($_) } qw(
428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5
 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174
 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da
 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967
 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85
 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070
 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3
 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2);
my @H = map { hex($_) } qw(6a09e667 bb67ae85 3c6ef372 a54ff53a 510e527f 9b05688c 1f83d9ab 5be0cd19);
my $MASK = 0xffffffff;
sub ror {
    my ($x, $n) = @_;
    return (($x >> $n) | (($x << (32-$n)) & 0xffffffff)) & 0xffffffff;
}
my $block = sub {
    my ($bytes) = @_;
    my @W = unpack("N16", $bytes);
    for my $i (16..63) {
        my $x = $W[$i-15]; my $y = $W[$i-2];
        my $s0 = ror($x,7) ^ ror($x,18) ^ ($x >> 3);
        my $s1 = ror($y,17) ^ ror($y,19) ^ ($y >> 10);
        $W[$i] = ($W[$i-16] + $s0 + $W[$i-7] + $s1) & $MASK;
    }
    my ($a,$b,$c,$d,$e,$f,$g,$h) = @H;
    for my $i (0..63) {
        my $s1 = ror($e,6) ^ ror($e,11) ^ ror($e,25);
        my $ch = ($e & $f) ^ (($e ^ $MASK) & $g);
        my $t1 = ($h + $s1 + $ch + $K[$i] + $W[$i]) & $MASK;
        my $s0 = ror($a,2) ^ ror($a,13) ^ ror($a,22);
        my $maj = ($a & $b) ^ ($a & $c) ^ ($b & $c);
        my $t2 = ($s0 + $maj) & $MASK;
        ($h,$g,$f,$e,$d,$c,$b,$a) = ($g,$f,$e,($d+$t1)&$MASK,$c,$b,$a,($t1+$t2)&$MASK);
    }
    my @state = ($a,$b,$c,$d,$e,$f,$g,$h);
    for my $i (0..7) { $H[$i] = ($H[$i]+$state[$i]) & $MASK; }
};
binmode(STDIN) or die "SHA256 stdin binary mode failed: $!\n";
my ($pending, $total) = ("", 0);
while (1) {
    my $chunk = "";
    my $n = read(STDIN, $chunk, 65536);
    defined($n) or die "SHA256 input read failed: $!\n";
    last if $n == 0;
    $total += $n;
    $total <= 268435456 or die "SHA256 Perl fallback limited to 256 MiB bootstrap files\n";
    $pending .= $chunk;
    my $full = length($pending) - length($pending)%64;
    for (my $off=0; $off<$full; $off+=64) { $block->(substr($pending,$off,64)); }
    substr($pending,0,$full,"");
}
$pending .= "\x80";
$pending .= "\0" x ((56-length($pending)%64+64)%64);
$pending .= pack("N2", int($total/536870912), ($total%536870912)*8);
for (my $off=0; $off<length($pending); $off+=64) { $block->(substr($pending,$off,64)); }
print(join("", map { sprintf("%08x", $_) } @H), "\n") or die "SHA256 output failed: $!\n";

'
}
hash_stream() {
  case "$SHA256_BACKEND" in
    perl-core) perl_core_sha256 ;;
    shasum) "$SHA256_TOOL" -a 256 ;;
    sha256sum) "$SHA256_TOOL" ;;
    sha256) "$SHA256_TOOL" -q ;;
    openssl) "$SHA256_TOOL" dgst -sha256 ;;
    perl) "$SHA256_TOOL" -MDigest::SHA -e 'binmode STDIN; print Digest::SHA->new(256)->addfile(*STDIN)->hexdigest, "\n";' ;;
    python3|python) "$SHA256_TOOL" -c 'import hashlib,sys
h=hashlib.sha256()
f=getattr(sys.stdin,"buffer",sys.stdin)
for chunk in iter(lambda:f.read(1048576),b""):
 h.update(chunk)
sys.stdout.write(h.hexdigest()+"\n")' ;;
    *) return 1 ;;
  esac
}
parse_digest() {
  local out=$1
  HASH=
  case "$out" in *$'\n'*|*$'\r'*) return 1;; esac
  case "$SHA256_BACKEND" in
    openssl) out=${out##* } ;;
    *) out=${out%%[[:space:]]*} ;;
  esac
  [[ "$out" =~ ^[0-9a-fA-F]{64}$ ]] || return 1
  # Bash 3.2 does not implement ${value,,}.
  out=${out//A/a}; out=${out//B/b}; out=${out//C/c}
  out=${out//D/d}; out=${out//E/e}; out=${out//F/f}
  HASH=$out
}
select_sha256() {
  local candidate path out rc expected
  SHA256_BACKEND=; SHA256_TOOL=; HASH=
  for candidate in shasum sha256sum sha256 openssl perl python3 python perl-core; do
    if [ "$candidate" = perl-core ]; then
      path=$(type -P perl) || continue
    else
      path=$(type -P "$candidate") || continue
    fi
    [ -x "$path" ] || continue
    SHA256_BACKEND=$candidate; SHA256_TOOL=$path
    out=$(hash_stream </dev/null 2>/dev/null); rc=$?
    [ "$rc" -lt 128 ] || die 'SHA-256 utility crashed. Stop and investigate this Recovery session.'
    if [ "$rc" != 0 ] || ! parse_digest "$out" ||
       [ "$HASH" != e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]; then
      say "SHA256_CANDIDATE_FAILED=$candidate"; continue
    fi
    out=$(printf abc | hash_stream 2>/dev/null); rc=$?
    [ "$rc" -lt 128 ] || die 'SHA-256 utility crashed. Stop and investigate this Recovery session.'
    if [ "$rc" != 0 ] || ! parse_digest "$out" ||
       [ "$HASH" != ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]; then
      say "SHA256_CANDIDATE_FAILED=$candidate"; continue
    fi
    out=$(printf '%s' 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq' | hash_stream 2>/dev/null); rc=$?
    [ "$rc" -lt 128 ] || die 'SHA-256 utility crashed. Stop and investigate this Recovery session.'
    if [ "$rc" != 0 ] || ! parse_digest "$out" ||
       [ "$HASH" != 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1 ]; then
      say "SHA256_CANDIDATE_FAILED=$candidate"; continue
    fi
    say "SHA256_BACKEND=$SHA256_BACKEND"
    say 'SHA256_SELFTEST_OK (empty input, abc, multiblock; not a hardware stability test)'
    if [ "$SHA256_BACKEND" = perl-core ]; then
      say 'SHA256_FALLBACK: core Perl, no modules; slow, for bootstrap files <=256 MiB only.'
    fi
    HASH=
    return 0
  done
  SHA256_BACKEND=; SHA256_TOOL=; HASH=
  say 'MISSING_CAPABILITY=working_SHA256'
  say 'Checked installed hash tools and the embedded module-free Perl fallback.'
  return 1
}
sha256_file() {
  local out rc
  HASH=
  [ -n "$SHA256_BACKEND" ] || select_sha256 || return 1
  out=$(hash_stream < "$1"); rc=$?
  [ "$rc" = 0 ] || return 1
  parse_digest "$out"
}
secure_state() {
  [ -d "$STATE" ] && [ ! -L "$STATE" ] || die 'Runtime directory missing or unsafe.'
  [ "$(stat -f '%u:%Lp' "$STATE")" = '0:700' ] || die 'Runtime directory must be root-owned, mode 700.'
}
safe_file() { [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -f '%u' "$1")" = 0 ]; }
read_saved() { safe_file "$STATE/$1" && IFS= read -r "$2" < "$STATE/$1"; }
check_tools() {
  local x missing=0 mode=${1:-prepare}
  local tools='sw_vers sysctl stat ps'
  case "$mode" in
    stop) tools="$tools mkdir rmdir sleep ifconfig" ;;
    status) ;;
    *) tools="$tools curl tar awk mkdir cp mv chmod sleep route ifconfig scutil tail cat grep rmdir" ;;
  esac
  for x in $tools; do
    type -P "$x" >/dev/null 2>&1 || { say "MISSING_TOOL=$x"; missing=1; }
  done
  case "$mode" in
    status|stop) ;;
    *) select_sha256 || missing=1 ;;
  esac
  [ "$missing" = 0 ]
}
need_tools() { check_tools "${1:-prepare}" || die 'Required capabilities missing. No automatic installation or checksum bypass.'; }
doctor() {
  local failed=0 out rc
  say "VLESS RECOVERY $VERSION — preflight only"
  say 'No downloads, URI access, client launch, or route/DNS/proxy changes.'
  check_tools prepare || failed=1
  if type -P sw_vers >/dev/null 2>&1; then
    out=$(sw_vers -productVersion); rc=$?
    [ "$rc" = 0 ] || die "sw_vers failed (exit $rc); stop and inspect Recovery."
    say "RECOVERY_VERSION=$out"
  fi
  if type -P sysctl >/dev/null 2>&1; then
    out=$(sysctl -n hw.machine); rc=$?
    [ "$rc" = 0 ] || die "sysctl failed (exit $rc); stop and inspect Recovery."
    say "ARCH=$out"
    [ "$out" = x86_64 ] || { say 'UNSUPPORTED_ARCH: Intel x86_64 required.'; failed=1; }
  fi
  [ "$failed" = 0 ] || die 'Preflight failed; do not run prepare/start.'
  say 'PREFLIGHT_OK: required commands found and SHA-256 self-test passed.'
  say 'Not proof of command runtime compatibility, stable RAM, VLESS, or TUN support.'
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
  [ "${1:-}" != doctor ] || { doctor; return; }
  need_tools "${1:-prepare}"
  case "$(sw_vers -productName)" in 'Mac OS X'|macOS) ;; *) die 'macOS required.';; esac
  [ "$(sysctl -n hw.machine)" = x86_64 ] || die 'This helper is for Intel macOS only.'
  case "${1:-prepare}" in
    status|stop)
      if [ ! -e "$STATE" ] && [ ! -L "$STATE" ]; then
        say 'CORE_NOT_RUNNING (no runtime directory in this session)'; return 0
      fi;;
  esac
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
    *) die 'Usage: bash vless.sh [doctor|prepare [local-link-file]|start|status|stop|--version]';;
  esac
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi