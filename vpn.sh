#!/bin/bash
# BigSurVPN bootstrap. Usage: curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/vpn.sh | bash
# The personal profile stays encrypted in the pinned installer; no keys here.
# Keep the invocation last: a truncated download must not run a partial function.
bigsur_vpn_bootstrap() (
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export LC_ALL=C
  unset BASH_ENV ENV CDPATH PYTHONHOME PYTHONPATH
  umask 077

  if [ "$(/usr/bin/uname -s)" != Darwin ]; then
    printf '%s\n' 'ОШИБКА: этот установщик предназначен для macOS Big Sur на Intel.' >&2
    exit 1
  fi
  # stdin contains this script when launched via curl | bash. Password prompts
  # must instead read from the controlling terminal, never from the pipe.
  if ! ( : < /dev/tty ) 2>/dev/null; then
    printf '%s\n' 'ОШИБКА: запустите команду в Терминале Mac; для пароля и ключа нужен терминал.' >&2
    exit 1
  fi

  work=$(/usr/bin/mktemp -d /private/var/tmp/bigsur-vpn-bootstrap.XXXXXX)
  trap '/bin/rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  printf '%s\n' 'Загрузка установщика BigSurVPN из GitHub...'
  /usr/bin/curl -q -fL --proto '=https' --proto-redir '=https' \
    --proxy '' --noproxy '*' --connect-timeout 20 --max-time 180 --retry 2 \
    'https://raw.githubusercontent.com/pioner22/MacOS/eeb6613b53fcb88b0c6284a2b9d563f603552352/vpn-bigsur.sh' \
    -o "$work/vpn-bigsur.sh" || {
      printf '%s\n' 'ОШИБКА: установщик не скачан. Ничего не установлено.' >&2
      exit 1
    }

  printf '%s  %s\n' \
    '5e6cb6b63c4b120503eafdb625cc5e5e5dbb8e6f4cb639498fbc94ad73bb04c8' \
    "$work/vpn-bigsur.sh" | /usr/bin/shasum -a 256 -c - || {
      printf '%s\n' 'ОШИБКА: SHA-256 не совпадает. Скачанный установщик не запущен.' >&2
      exit 1
    }

  printf '%s\n' 'Для расшифровки профиля потребуется ключ установки из предыдущего сообщения.'
  /bin/bash "$work/vpn-bigsur.sh" install < /dev/tty
)
bigsur_vpn_bootstrap "$@"
