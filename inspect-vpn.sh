#!/bin/bash
# Inspect the existing private VPN subscription on A1398, without starting a VPN.
# No new link, no core download, no installer, no DNS/proxy/routes changes.
# Only fixed protocol parameters and converter rejection messages are displayed.
# The helper library is pinned and hash-checked before sourcing. Responses are data.
INSPECT_DIR=
inspect_cleanup() {
  local rc=$?
  trap - EXIT INT TERM HUP
  if [ -n "$INSPECT_DIR" ] && [ -d "$INSPECT_DIR" ] && [ ! -L "$INSPECT_DIR" ]; then
    case "$INSPECT_DIR" in "$HOME"/.macos-vpn-info.*) /bin/rm -rf -- "$INSPECT_DIR";; esac
  fi
  exit "$rc"
}
profile_summary() {
  local record=$1 number=$2 scheme rest query item key raw value status reason
  scheme=${record%%://*}
  case "$scheme" in vless|vmess|trojan|ss|ssr|hysteria|hysteria2|hy2|tuic|socks|http|https) ;; *) scheme=OTHER;; esac
  say "PROFILE_$number PROTOCOL=$scheme"
  rest=${record%%#*}
  case "$rest" in *\?*) query=${rest#*\?};; *) query=;; esac
  while [ -n "$query" ]; do
    item=${query%%&*}; if [ "$query" = "$item" ]; then query=; else query=${query#*&}; fi
    key=${item%%=*}; raw=${item#*=}
    case "$key" in security|type|flow|fp|encryption) ;; *) continue;; esac
    value=OTHER_OR_INVALID
    if decode_value "$raw"; then
      case "$key:$VALUE" in
        security:reality|security:tls|security:none|type:tcp|type:raw|type:ws|type:grpc|type:http|type:httpupgrade|type:xhttp|type:h2|type:quic|flow:xtls-rprx-vision|flow:xtls-rprx-vision-udp443|fp:chrome|fp:firefox|fp:safari|fp:ios|fp:edge|fp:android|fp:360|fp:qq|fp:random|fp:randomized|encryption:none) value=$VALUE;;
        security:|type:|flow:|fp:|encryption:) value=EMPTY;;
      esac
    fi
    say "PROFILE_$number $key=$value"
  done
  unset VALUE
  if [ "$scheme" != vless ]; then
    say "PROFILE_$number RESULT=UNSUPPORTED_PROTOCOL"; return
  fi
  reason=$( (parse_uri "$record") 2>&1 ); status=$?
  if [ "$status" = 0 ]; then
    say "PROFILE_$number RESULT=SUPPORTED_BY_CONVERTER"; return
  fi
  # Only our fixed parser messages may be displayed. Do not echo untrusted input.
  case "$reason" in
    'STOP: URI too long.'|'STOP: URI must be a single line.'|'STOP: Expected a VLESS URI with parameters.'|'STOP: Invalid UUID.'|'STOP: Only a DNS hostname or IPv4 server is supported.'|'STOP: Invalid server port.'|'STOP: Unsupported URI parameter; no silent conversion.'|'STOP: Invalid URI parameter.'|'STOP: Duplicate URI parameter.'|'STOP: Invalid percent encoding.'|'STOP: Only VLESS / REALITY / Vision / TCP / encryption=none is supported.'|'STOP: This profile converter expects fp=chrome.'|'STOP: Invalid REALITY public key encoding.'|'STOP: Invalid REALITY short ID.'|'STOP: REALITY sid is required (may be empty).'|'STOP: Invalid SNI.')
      say "PROFILE_$number REASON=${reason#STOP: }";;
    *) say "PROFILE_$number REASON=PARSER_FAILED_DETAILS_NOT_DISCLOSED";;
  esac
}

inspect_records() {
  local text=$1 line n=0 first=1
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$first" = 1 ]; then line=${line#$'\357\273\277'}; first=0; fi
    line=${line%$'\r'}
    line=${line#"${line%%[!$' \t']*}"}; line=${line%"${line##*[!$' \t']}"}
    case "$line" in ''|\#*) continue;; esac
    n=$((n+1))
    [ "$n" -le 128 ] && [ "${#line}" -le 4096 ] || die 'Record limits exceeded.'
    case "$line" in *://*) ;; *) die 'Subscription is not a URI list.';; esac
    profile_summary "$line" "$n"
  done < "$text"
  [ "$n" -gt 0 ] || die 'No subscription records found.'
  say "INSPECTED_RECORDS=$n"
}
inspect_main() {
  set +x
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077
  ulimit -c 0 2>/dev/null || :
  [ "$EUID" != 0 ] || { printf '%s\n' 'STOP: run on A1398 in normal macOS, WITHOUT sudo.'; return 1; }
  [ -x /usr/bin/sw_vers ] && [ -x /usr/bin/curl ] && [ -x /usr/bin/shasum ] || {
    printf '%s\n' 'STOP: full macOS with curl and shasum is required.'; return 1;
  }
  INSPECT_DIR=$(/usr/bin/mktemp -d "$HOME/.macos-vpn-info.XXXXXX") || return 1
  trap inspect_cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  local out hash
  printf '%s\n' 'VPN PROFILE INSPECTOR 1.0.0 - A1398 only; no VPN startup or Apple download.'
  /usr/bin/curl -q -4 -fsSL --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 60 \
    'https://raw.githubusercontent.com/pioner22/MacOS/b2f6f63acb665b16559332766ae44999ed72e1c6/download-vpn.sh' \
    -o "$INSPECT_DIR/source.sh" || return 1
  out=$(/usr/bin/shasum -a 256 < "$INSPECT_DIR/source.sh") || return 1
  hash=${out%% *}
  [ "$hash" = 'a384448c873426046746f31e8daf240ea3fdcc290f71863a1472cd2286458e3b' ] || {
    printf '%s\n' 'STOP: helper checksum mismatch; nothing sourced.'; return 1;
  }
  /bin/bash -n "$INSPECT_DIR/source.sh" || return 1
  # Source definitions only: the library's main is protected by BASH_SOURCE.
  source "$INSPECT_DIR/source.sh"
  RUN=$INSPECT_DIR
  say 'Using the already configured subscription. URL and credentials are not printed.'
  subscription_fetch "$DEFAULT_SUBSCRIPTION"
  subscription_decode "$RUN/subscription.body"
  inspect_records "$SUBSCRIPTION_TEXT"
  unset URI UUID PBK SID SNI HOST PORT VALUE DEFAULT_SUBSCRIPTION SUBSCRIPTION_TEXT
  say 'INSPECTION_DONE: format only. No VPN connection or Apple download was attempted.'
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then inspect_main "$@"; fi
