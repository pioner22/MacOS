#!/bin/bash
# Compatibility entry; never execute a partial/unverified download.
diag_entry(){
  local tmp got
  umask 077
  tmp=$(mktemp /tmp/macdiag-entry.XXXXXX) || return 3
  MACDIAG_ENTRY_TMP=$tmp
  trap 'rm -f "$MACDIAG_ENTRY_TMP"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
    'https://raw.githubusercontent.com/pioner22/MacOS/14656dffb0644c417b72abe2d6bb090c56f70cc2/st.sh' -o "$tmp" || return 3
  if command -v sha256sum >/dev/null 2>&1;then got=$(sha256sum "$tmp") || return 3
  elif command -v shasum >/dev/null 2>&1;then got=$(shasum -a 256 "$tmp") || return 3
  else return 3;fi
  [ "${got%% *}" = 98e4067b5e209c497bdec137a00eeb43bc5995a2cff834f8c0b2d146d3200afc ] || { echo 'RESULT=INCONCLUSIVE BOOTSTRAP_HASH_FAILED';return 3; }
  /bin/bash -n "$tmp" || return 3
  /bin/bash "$tmp" "$1"
}
diag_entry gpu
exit $?
