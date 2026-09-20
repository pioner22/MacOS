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
    'https://raw.githubusercontent.com/pioner22/MacOS/c6e14dda36146cf697d89f4b7d8cc93af633005d/st.sh' -o "$tmp" || return 3
  if command -v sha256sum >/dev/null 2>&1;then got=$(sha256sum "$tmp") || return 3
  elif command -v shasum >/dev/null 2>&1;then got=$(shasum -a 256 "$tmp") || return 3
  else return 3;fi
  [ "${got%% *}" = 51dd36c157995df9737fdcc55d613843564f430ae3a2a9c7ad4194713cd3b72c ] || { echo 'RESULT=INCONCLUSIVE BOOTSTRAP_HASH_FAILED';return 3; }
  /bin/bash -n "$tmp" || return 3
  /bin/bash "$tmp" "$1"
}
diag_entry acceptance
exit $?
