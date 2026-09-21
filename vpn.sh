#!/bin/bash
# BigSurVPN 2.1.2. One command: download -> configure -> launch -> verify -> speed.
# Usage: curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/vpn.sh | bash
# PERSONAL PUBLIC PRESET: the owner explicitly requested embedded VPN access.
# Anyone able to download vpn-profile.json can use its subscription/credentials.
# Invocation stays last: do not execute an incompletely downloaded function.
bigsur_vpn_bootstrap() (
  set +x
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export LC_ALL=C
  unset BASH_ENV ENV CDPATH PYTHONHOME PYTHONPATH VPN_INSTALL_KEY
  umask 077
  local runtime_ref=e6cd152f25d0b254667706950a025a881520e3d6
  local runtime_sha=131296d7736026474dca2c040796c5105221fee2eacf2560defff8c9266df8ad
  local profile_ref=93ccab1365bab351dd10bdf861a5facc53e6a642
  local profile_sha=0d45033f165b47595e78e5127233d8e1e802e7be3391afa7d325702af89524ad
  local work runner
  printf '%s\n' 'BigSurVPN 2.1.2 — выбор Xray или SOCKS5, установка/обновление и проверка.'
  printf '%s\n' 'При повторном запуске VPN переподключается; временно возможен прямой интернет.'
  printf '%s\n' 'VPN-данные встроены в отдельный публичный профиль. Ключ установки не нужен.'
  [ "$(/usr/bin/uname -s)" = Darwin ] || { printf '%s\n' 'ОШИБКА: требуется macOS.' >&2; exit 1; }
  case "$(/usr/bin/sw_vers -productVersion)" in
    11.*) ;;
    *) printf '%s\n' 'ОШИБКА: эта версия рассчитана на Big Sur 11.x.' >&2; exit 1;;
  esac
  [ "$(/usr/bin/uname -m)" = x86_64 ] || { printf '%s\n' 'ОШИБКА: требуется Intel Mac.' >&2; exit 1; }
  [ -d /System/Volumes/Data ] || { printf '%s\n' 'ОШИБКА: Internet Recovery не поддерживается.' >&2; exit 1; }
  /usr/bin/python -E -s -B -c 'import sys; assert sys.version_info[:2] == (2,7)' >/dev/null 2>&1 || {
    printf '%s\n' 'ОШИБКА: не найден штатный Python 2.7 Big Sur. Xcode/Homebrew не устанавливаются.' >&2
    exit 1
  }
  if [ "$EUID" -ne 0 ] && ! ( : < /dev/tty ) 2>/dev/null; then
    printf '%s\n' 'ОШИБКА: нужен Терминал для подтверждения прав администратора Mac.' >&2
    exit 1
  fi
  work=$(/usr/bin/mktemp -d /private/var/tmp/bigsur-vpn-bootstrap.XXXXXX)
  trap '/bin/rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  fetch_checked() {
    local url=$1 output=$2 expected=$3
    printf '%s\n' "Загрузка $(/usr/bin/basename "$output") с GitHub..."
    (
      ulimit -f 4096
      /usr/bin/curl -q -fL --proto '=https' --proto-redir '=https' \
        --proxy '' --noproxy '*' --connect-timeout 20 --max-time 180 \
        --max-filesize 2097152 --retry 2 -H 'Cache-Control: no-cache' "$url" -o "$output"
    ) || { printf '%s\n' 'ОШИБКА: загрузка не завершена. Непроверенный код не запускается.' >&2; exit 1; }
    printf '%s  %s\n' "$expected" "$output" | /usr/bin/shasum -a 256 -c - || {
      printf '%s\n' 'ОШИБКА: SHA-256 не совпадает. Выполнение отменено.' >&2
      exit 1
    }
  }
  fetch_checked "https://raw.githubusercontent.com/pioner22/MacOS/$runtime_ref/vpn-runtime.py" "$work/vpn-runtime.py" "$runtime_sha"
  fetch_checked "https://raw.githubusercontent.com/pioner22/MacOS/$profile_ref/vpn-profile.json" "$work/vpn-profile.json" "$profile_sha"

  # Verify again after elevation, then execute only the verified bytes from a
  # root-owned temporary directory. No getpass, key-stdin or credentials in argv.
  runner='import hashlib, os, shutil, sys, tempfile
os.umask(0o077)
if os.geteuid() != 0:
    sys.exit("Administrator privileges are required.")
items = [(sys.argv[1], sys.argv[2], "vpn-runtime.py"), (sys.argv[3], sys.argv[4], "vpn-profile.json")]
verified = []
for path, expected, name in items:
    with open(path, "rb") as stream:
        payload = stream.read(2097153)
    if len(payload) > 2097152 or hashlib.sha256(payload).hexdigest() != expected:
        sys.exit("SHA-256 verification failed after privilege elevation; nothing executed.")
    verified.append((name, payload))
root = tempfile.mkdtemp(prefix="bigsur-vpn-root-", dir="/private/var/tmp")
try:
    for name, payload in verified:
        with open(os.path.join(root, name), "wb") as stream:
            stream.write(payload)
    script = os.path.join(root, "vpn-runtime.py")
    sys.argv = [script, "setup", os.path.join(root, "vpn-profile.json")]
    scope = {"__name__": "__main__", "__file__": script, "__package__": None}
    exec(compile(verified[0][1], script, "exec"), scope)
finally:
    shutil.rmtree(root)
'
  printf '%s\n' 'Начинаю автоматическую установку. Может понадобиться только пароль администратора Mac.'
  if [ "$EUID" -eq 0 ]; then
    /usr/bin/python -E -s -B -c "$runner" "$work/vpn-runtime.py" "$runtime_sha" "$work/vpn-profile.json" "$profile_sha" < /dev/null
  else
    /usr/bin/sudo /usr/bin/python -E -s -B -c "$runner" "$work/vpn-runtime.py" "$runtime_sha" "$work/vpn-profile.json" "$profile_sha" < /dev/tty
  fi
)
bigsur_vpn_bootstrap "$@"
