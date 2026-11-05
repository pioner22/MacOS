#!/bin/bash
# One command for an existing installation: diagnose both SOCKS5 endpoints,
# select the working endpoint and verify the actual tunnel. No automatic updater.
# Fresh installation retains the previously published installer/menu.
bigsur_vpn_entry() (
  set +x
  set -euo pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  unset BASH_ENV ENV CDPATH PYTHONHOME PYTHONPATH PERL5OPT PERL5LIB PERLLIB PERL_UNICODE
  umask 077
  local repair_ref='a3c46d6e4f044aa91ef919c0c97d78d908b71f79'
  local repair_sha='7f64a270fa2e488a1f8aba686feb342abc16f63bd00f4fa6861d8b07289019ba'
  local work result=0 runner actual
  [ "$#" -eq 0 ] || { printf '%s\n' 'Запускайте эту ссылку без аргументов.' >&2; exit 2; }
  [ "$(/usr/bin/uname -s)" = Darwin ] || { printf '%s\n' 'Требуется macOS Big Sur.' >&2; exit 1; }
  case "$(/usr/bin/sw_vers -productVersion)" in 11.*) ;; *) printf '%s\n' 'Требуется установленная macOS Big Sur 11.x.' >&2; exit 1;; esac
  [ "$(/usr/bin/uname -m)" = x86_64 ] && [ -d /System/Volumes/Data ] || {
    printf '%s\n' 'Нужен Intel Mac с установленной ОС, не Recovery.' >&2; exit 1;
  }
  /usr/bin/python -E -s -B -c 'import sys; assert sys.version_info[:2] == (2,7)' >/dev/null 2>&1 || {
    printf '%s\n' 'Не найден штатный Python 2.7. Дополнительные программы не устанавливаются.' >&2; exit 1;
  }
  work=$(/usr/bin/mktemp -d /private/var/tmp/bigsur-vpn-entry.XXXXXX)
  trap '/bin/rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  fetch() {
    (
      ulimit -f 2048
      /usr/bin/curl -q -fLsS --proto '=https' --proto-redir '=https' \
        --connect-timeout 15 --max-time 120 --max-filesize 262144 --max-redirs 3 \
        --proxy '' --noproxy '*' "$1" -o "$2" </dev/null
    ) || { printf '%s\n' 'Загрузка не завершена; скачанный код не запускается.' >&2; exit 1; }
  }
  if [ ! -e /Library/BigSurVPN/current ] && [ ! -L /Library/BigSurVPN/current ]; then
    printf '%s\n' 'Существующая установка не найдена. Открываю прежний мастер первой установки.'
    fetch 'https://raw.githubusercontent.com/pioner22/MacOS/b9727f95971a9bf548cb84819bd09340497cf226/vpn/vpn.sh' "$work/install.sh"
    actual=$(/usr/bin/perl -f -MDigest::SHA=sha1_hex -e '
      open my $f,"<",$ARGV[0] or exit 1; binmode $f;
      local $/; my $data=<$f>; length($data)<=262144 or exit 1;
      print sha1_hex("blob ".length($data)."\0".$data);
    ' "$work/install.sh")
    [ "$actual" = '7c65cd1e9a60da386a94041cc20b6851f7812f81' ] || { printf '%s\n' 'Повреждён установщик; запуск отменён.' >&2; exit 1; }
    /bin/bash -n "$work/install.sh"
    /bin/bash "$work/install.sh" || result=$?
    exit "$result"
  fi
  printf '%s\n' 'BigSurVPN — единый запуск: проверка двух адресов и восстановление подключения (1.0).'
  printf '%s\n' 'Сначала 87.251.86.229:45004, затем 144.31.180.114:45004. Пароль SOCKS5 берётся из локальных настроек.'
  printf '%s\n' 'При проверке подключение может прерываться; прямой интернет не блокируется.'
  printf '%s\n' 'Ядро и версия CLI сохраняются. Экспериментальная служба/автообновление не устанавливаются.'
  fetch "https://raw.githubusercontent.com/pioner22/MacOS/$repair_ref/vpn/connection-repair.py" "$work/repair.py"
  printf '%s  %s\n' "$repair_sha" "$work/repair.py" | /usr/bin/shasum -a 256 -c - || {
    printf '%s\n' 'Контрольная сумма не совпала; запуск отменён.' >&2; exit 1;
  }
  # Verify exactly the same bytes again after privilege elevation, before execution.
  runner='import hashlib, os, shutil, sys, tempfile
os.umask(0o077)
if os.geteuid() != 0:
    sys.exit("Administrator privileges required.")
with open(sys.argv[1], "rb") as source:
    payload = source.read(262145)
if len(payload) > 262144 or hashlib.sha256(payload).hexdigest() != sys.argv[2]:
    sys.exit("Integrity verification failed; nothing executed.")
root = tempfile.mkdtemp(prefix="bigsur-vpn-repair-", dir="/private/var/tmp")
try:
    script = os.path.join(root, "connection-repair.py")
    with open(script, "wb") as output:
        output.write(payload)
    sys.argv = [script]
    scope = {"__name__": "__main__", "__file__": script, "__package__": None}
    exec(compile(payload, script, "exec"), scope)
finally:
    shutil.rmtree(root)
'
  if [ "$EUID" -eq 0 ]; then
    /usr/bin/python -E -s -B -c "$runner" "$work/repair.py" "$repair_sha" </dev/null || result=$?
  else
    ( : </dev/tty ) 2>/dev/null || { printf '%s\n' 'Нужен Терминал для системного подтверждения администратора.' >&2; exit 1; }
    /usr/bin/sudo /usr/bin/python -E -s -B -c "$runner" "$work/repair.py" "$repair_sha" </dev/tty || result=$?
  fi
  # Exit 2 means CONNECTED_WITH_WARNINGS (known SOCKS5 limitations), not failure.
  exit "$result"
)
bigsur_vpn_entry "$@"
