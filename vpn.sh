#!/bin/bash
# BigSurVPN one-command setup 1.1.0: install, configure, connect, verify.
# A personal command supplies VPN_INSTALL_KEY; no key is published here.
# Existing installed profiles do not need a key again.
# Keep invocation last to reject a script truncated during curl | bash.
bigsur_vpn_bootstrap() (
  set +x
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export LC_ALL=C
  unset BASH_ENV ENV CDPATH PYTHONHOME PYTHONPATH
  umask 077
  local install_key="${VPN_INSTALL_KEY-}"
  unset VPN_INSTALL_KEY
  export -n install_key 2>/dev/null || :
  if [ -n "$install_key" ] && ! [[ "$install_key" =~ ^[0-9a-f]{32}$ ]]; then
    printf '%s\n' 'ОШИБКА: некорректный ключ в персональной команде. Ничего не установлено.' >&2
    exit 1
  fi
  if [ "$(/usr/bin/uname -s)" != Darwin ]; then
    printf '%s\n' 'ОШИБКА: требуется установленная macOS Big Sur на Intel.' >&2
    exit 1
  fi
  if [ "$EUID" -ne 0 ] && ! ( : < /dev/tty ) 2>/dev/null; then
    printf '%s\n' 'ОШИБКА: запустите команду в Терминале Mac; для пароля администратора нужен терминал.' >&2
    exit 1
  fi

  local work
  work=$(/usr/bin/mktemp -d /private/var/tmp/bigsur-vpn-bootstrap.XXXXXX)
  trap '/bin/rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf '%s\n' 'BigSurVPN: установка -> настройка -> подключение -> проверка связи.'
  /usr/bin/curl -q -fL --proto '=https' --proto-redir '=https' \
    --proxy '' --noproxy '*' --connect-timeout 20 --max-time 180 --retry 2 \
    'https://raw.githubusercontent.com/pioner22/MacOS/04e5db8fab81a09944cbfbdc3f739ae0edc14567/vpn-bigsur.sh' \
    -o "$work/vpn-bigsur.sh" || {
      printf '%s\n' 'ОШИБКА: установщик не скачан. Ничего не установлено.' >&2
      exit 1
    }
  printf '%s  %s\n' \
    'a7ebc561b25608d00b002d8556dfaee0c0c36c04e6859c386af687408e95792a' \
    "$work/vpn-bigsur.sh" | /usr/bin/shasum -a 256 -c - || {
      printf '%s\n' 'ОШИБКА: SHA-256 не совпадает. Установщик не запущен.' >&2
      exit 1
    }
  # The key travels over stdin through sudo, not through argv or sudo -E.
  # sudo reads the macOS administrator password from /dev/tty, NOT this pipe.
  # setup reuses a private local profile when present, even with an empty key.
  printf '%s\n' "$install_key" | /bin/bash "$work/vpn-bigsur.sh" setup --key-stdin
)
bigsur_vpn_bootstrap "$@"
