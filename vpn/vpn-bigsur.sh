#!/bin/bash
# BigSurVPN 1.1.0 — macOS 11 Big Sur, Intel. No Homebrew/App Store/Xcode.
# Public installer; personal subscription is encrypted, never executed as code.
set +x
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
export LC_ALL=C
unset PYTHONPATH PYTHONHOME BASH_ENV ENV CDPATH
umask 077
VERSION=1.1.0
BASE=/Library/BigSurVPN
LABEL=ru.pioner22.bigsur-vpn
COMMAND=/usr/local/bin/vpn-bigsur
CORE_VERSION=1.14.0
ASSET=sing-box-1.14.0-darwin-amd64-legacy-macos-10.13.tar.gz
CORE_SHA=99285bb2d30739dc8884144cf90f50538336eab9914ac4524290f5b82fdb5565
HELPER_REF=77b8302236f0a7c36970e4843f90e1fc964bbcf1
HELPER_SHA=f0d8d7c90cccc14764c4e1722361f35a569509bf3cc383fdecec6bcb0f88dd5f
TMP=
PYTHON=
KEY_STDIN=0
RESET_PROFILE=
say() { printf '%s\n' "$*"; }
die() { say "ОШИБКА: $*" >&2; exit 1; }
cleanup() { if [ -n "$TMP" ] && [ -d "$TMP" ]; then /bin/rm -rf "$TMP"; fi; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

help_text() {
  cat <<'HELP'
BigSurVPN 1.1.0 — установленная macOS Big Sur 11.x, Intel.

Установка и подключение: /bin/bash vpn-bigsur.sh setup
Только установка:         /bin/bash vpn-bigsur.sh install-only
Включить:       vpn-bigsur on
Выключить:      vpn-bigsur off
Состояние:      vpn-bigsur status
Проверка связи: vpn-bigsur test
Серверы:        vpn-bigsur list
Выбрать:       vpn-bigsur select НОМЕР
Подписка:       vpn-bigsur update
Лог запуска:    vpn-bigsur logs
Удалить:        vpn-bigsur uninstall

Установка скачивает файлы только из GitHub (включая GitHub CDN).
При первом включении пробуются ранее предоставленные резервные ключи.
После успешного подключения подписка обновляется через VPN.
Персональная команда из чата передаёт ключ автоматически; не публикуйте её.
setup --key-stdin получает ключ через stdin без интерактивного запроса.
При готовой установке setup использует локальный профиль без ключа.
SIP/Gatekeeper/сертификаты не отключаются. Режим Recovery не поддерживается.
Автозапуска после перезагрузки и kill switch нет.
HELP
}

find_python() {
  # macOS 11 ships Python 2.7. Do not invoke a Python3/Xcode installer stub.
  for p in /usr/bin/python /usr/bin/python2.7; do
    if [ -x "$p" ] && "$p" -E -s -c 'import sys; assert sys.version_info[:2] == (2,7)' >/dev/null 2>&1; then
      PYTHON=$p
      return
    fi
  done
  die 'Не найден штатный Python 2.7 Big Sur. Ничего дополнительно не устанавливаю.'
}

check_target() {
  [ "$(/usr/bin/uname -s)" = Darwin ] || die 'Требуется macOS Big Sur, не Linux/Windows.'
  case "$(/usr/bin/sw_vers -productVersion)" in 11.*) ;; *) die 'Эта сборка установщика предназначена для macOS 11.x Big Sur.';; esac
  [ "$(/usr/bin/uname -m)" = x86_64 ] || die 'Эта сборка предназначена для Intel Mac, не Apple Silicon.'
  [ -d /System/Volumes/Data ] || die 'Нужна установленная macOS, не Internet Recovery.'
  find_python
}

root_only() {
  if [ "$EUID" -ne 0 ]; then
    exec /usr/bin/sudo /bin/bash "$0" "$@"
  fi
}

owned_dir() {
  [ ! -L "$1" ] || die "Каталог является ссылкой: $1"
  if [ -e "$1" ]; then
    [ -d "$1" ] && [ "$(/usr/bin/stat -f '%u' "$1")" = 0 ] || die "Небезопасный каталог: $1"
  fi
}

sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/awk '{print $1}'; }
fetch() {
  local url=$1 file=$2 expected=$3
  /usr/bin/curl -q -fL --proto '=https' --proto-redir '=https' \
    --proxy '' --noproxy '*' --connect-timeout 20 --max-time 1800 \
    --retry 2 --retry-delay 2 --speed-time 120 --speed-limit 512 \
    "$url" -o "$file" || die 'Скачивание не завершено. Проверьте доступ к GitHub и его release-assets CDN.'
  [ "$(sha256 "$file")" = "$expected" ] || die 'SHA-256 не совпадает. Скачанный код НЕ будет запущен.'
}

install_vpn() {
  owned_dir "$BASE"
  owned_dir "$BASE/private"
  if /bin/launchctl print "system/$LABEL" >/dev/null 2>&1; then
    die 'Сначала остановите VPN: vpn-bigsur off'
  fi
  if [ -e "$COMMAND" ] || [ -L "$COMMAND" ]; then
    [ -L "$COMMAND" ] && [ "$(/usr/bin/readlink "$COMMAND")" = "$BASE/vpn-bigsur.sh" ] || die 'Команда vpn-bigsur уже принадлежит другому файлу; не перезаписываю.'
  fi
  TMP=$(/usr/bin/mktemp -d /private/var/tmp/bigsur-vpn.XXXXXX) || die 'Не удалось создать временный каталог.'
  /bin/cp "$0" "$TMP/controller.sh"
  say '[1/7] Загрузка контроллера из GitHub; проверка SHA-256.'
  fetch "https://raw.githubusercontent.com/pioner22/MacOS/$HELPER_REF/vpn-bigsur.py" "$TMP/helper.py" "$HELPER_SHA"
  if [ -f "$BASE/private/profiles.json" ] && [ "${1:-}" != --reset-profile ]; then
    [ ! -L "$BASE/private/profiles.json" ] || die 'Файл профилей не должен быть ссылкой.'
    /bin/cp "$BASE/private/profiles.json" "$TMP/profiles.json"
    say '[2/7] Существующая локальная подписка сохранена.'
  else
    say '[2/7] Подготовка встроенной подписки.'
    cat > "$TMP/preset.json" <<'ENCRYPTED_PRESET'
{"format":"BigSurVPN-envelope-v1","ciphertext":"U2FsdGVkX18s2cICEXo+DqkPaCMhVx6SidZz8C3/fOMrjuYUNv7rMtsy/WUTBP3iwb+AiGfU41SeKHqRYV7Nf/RE7k/ahAi/bMTBI79/hRPoXVD8IVH7DfSkAnr6CkN7K2/ureOHKAXPL9jX9ZRyqErBpzanjNKzv0tTTvdE7rOG4PRqAq9TFpPmcVHCjH7u3w+GPjyYz8kq7eUCJpRO/oOOQrhkRjxUJ7/mgEdwTxhUI6tKr3Qy+0NVRNjY8Cca13eZNmEuMLDTod0c+Rz+DMkLOAefn9FqCaKKhbDamFnYxxFsNKgBscWs/nwY4JQvxRPOP57P6xiwQNELu3NOcifOS3kjufy9eGBWPFw+AS65NozjvPfSg4Wob6Js4B5AVsPfbin4McAAdFefnpsOGnGxGcfvJxKEpYDiW0+Ffj3iB209uwyAPeJxKgTanrx0XVKtBK2Jd454FA9il4aQjkJoPxITbk6KwWeud5xHWp7m2aCBNMO6A5JpLstsN9Nx1rphCF4K+mlfz+TOr69uoFwp5e3RDHYohdPV+ZBTd3ixoxw/fmeVUBOwLWd4Hi0e8J51AFXxX+SsSny+aFmiL+fwDXXEO90V6Hivr+eFHGjw0hn9mbRbJkTlDem/1cXb2UG6Q1MMUKtLijECswiYHc2DBIgMvl9265zsXVJRMz6a9fdJzOs2noL772Vh1S+SbfmjMtofbaezV12bXX+zEFAEhhdEtdJyyHr3Hu3muaAXrXq898gnWKVSN32+yLHH","hmac_sha256":"b175322f4005b2205257ea11bdf4e9901b7b61076e48c981bfd621867802b883"}
ENCRYPTED_PRESET
    unlock_profile "$TMP/helper.py" "$TMP/preset.json" "$TMP/profiles.json"
  fi
  say '[3/7] Загрузка официального legacy-ядра для Intel (около 26 МБ).'
  fetch "https://github.com/SagerNet/sing-box/releases/download/v$CORE_VERSION/$ASSET" "$TMP/core.tar.gz" "$CORE_SHA"
  "$PYTHON" -E -s "$TMP/helper.py" extract "$TMP/core.tar.gz" "$TMP/sing-box"
  say '[4/7] Проверка запуска ядра именно на этом Mac, без изменения сети.'
  "$TMP/sing-box" version > "$TMP/version.txt" 2>&1 || die 'Legacy-ядро не запускается. Защита macOS НЕ отключается.'
  /usr/bin/grep -Fxq "sing-box version $CORE_VERSION" "$TMP/version.txt" || die 'Неожиданная версия ядра.'
  say '[5/7] Установка локальной команды и закрытого каталога профилей.'
  /usr/bin/install -d -o root -g wheel -m 755 "$BASE"
  /usr/bin/install -d -o root -g wheel -m 700 "$BASE/private"
  /usr/bin/install -o root -g wheel -m 755 "$TMP/sing-box" "$BASE/sing-box"
  /usr/bin/install -o root -g wheel -m 644 "$TMP/helper.py" "$BASE/vpn-bigsur.py"
  /usr/bin/install -o root -g wheel -m 755 "$TMP/controller.sh" "$BASE/vpn-bigsur.sh"
  /usr/bin/install -o root -g wheel -m 600 "$TMP/profiles.json" "$BASE/private/profiles.json"
  printf '%s\n' "$VERSION" > "$BASE/VERSION"
  /bin/chmod 644 "$BASE/VERSION"
  [ ! -L /usr/local ] && [ ! -L /usr/local/bin ] || die '/usr/local/bin является ссылкой. Используйте /Library/BigSurVPN/vpn-bigsur.sh.'
  [ -d /usr/local/bin ] || /bin/mkdir -p /usr/local/bin
  if [ ! -L "$COMMAND" ]; then /bin/ln -s "$BASE/vpn-bigsur.sh" "$COMMAND"; fi
  say 'УСТАНОВЛЕНО. Настройки сохранены локально.'
  say 'Включить: vpn-bigsur on'
  say 'Выключить: vpn-bigsur off'
  say 'Если команда не найдена: /usr/local/bin/vpn-bigsur on'
}


# Compatibility adapter for the pinned 1.0 controller. Only its input method
# changes in a separate Python process; HMAC validation and decryption stay
# in the original checksum-verified controller. No credentials in argv/env.
unlock_profile() {
  if [ "$KEY_STDIN" = 1 ]; then
    "$PYTHON" -E -s -c '
import getpass, re, runpy, sys
def key_from_stdin(prompt):
    key = sys.stdin.readline(129).rstrip("\r\n")
    if len(key) != 32 or not re.match(r"^[0-9a-f]{32}$", key):
        sys.exit("Installation key missing/invalid. Use the PERSONAL one-command setup from chat; do not publish it.")
    return key
getpass.getpass = key_from_stdin
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name="__main__")
' "$1" unlock "$2" "$3"
  else
    "$PYTHON" -E -s "$1" unlock "$2" "$3"
  fi
}

setup_vpn() {
  owned_dir "$BASE"
  owned_dir "$BASE/private"
  if [ -z "$RESET_PROFILE" ] && [ -f "$BASE/VERSION" ] &&
     [ -f "$BASE/private/profiles.json" ] && [ -x "$BASE/sing-box" ] &&
     [ -f "$BASE/vpn-bigsur.py" ]; then
    [ ! -L "$BASE/private/profiles.json" ] && [ ! -L "$BASE/vpn-bigsur.py" ] &&
      [ ! -L "$BASE/sing-box" ] || die 'Небезопасная существующая установка.'
    [ "$(sha256 "$BASE/vpn-bigsur.py")" = "$HELPER_SHA" ] ||
      die 'Контроллер изменён. Автоматический запуск неизвестного кода отменён.'
    say 'Установка уже существует: использую сохранённые настройки, без повторного ввода ключа.'
  else
    install_vpn "$RESET_PROFILE"
  fi
  say '[6/7] Автоматическое подключение VPN и проверка системных маршрутов.'
  if ! "$PYTHON" -E -s "$BASE/vpn-bigsur.py" on; then
    # Only stop our service, never another VPN. Do not print success on failure.
    "$PYTHON" -E -s "$BASE/vpn-bigsur.py" off || :
    die 'Установка сохранена, но VPN не подключён. Смотрите причину выше. Повторить: vpn-bigsur on'
  fi
  say '[7/7] Контрольный HTTPS-запрос через системный VPN.'
  if ! "$PYTHON" -E -s "$BASE/vpn-bigsur.py" test; then
    "$PYTHON" -E -s "$BASE/vpn-bigsur.py" off || :
    die 'Проверка связи не прошла; VPN остановлен. Готовность НЕ подтверждена.'
  fi
  say 'ГОТОВО: VPN настроен, подключён; проверка HTTPS успешна.'
  say 'Выключить: vpn-bigsur off | Включить позднее: vpn-bigsur on'
  say 'Автозапуска после перезагрузки и kill switch нет.'
}

CMD=${1:-help}
case "$CMD" in help|-h|--help) help_text; exit 0;; esac
check_target
root_only "$@"
shift || true
case "$CMD" in
  install|setup|install-only)
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --key-stdin) KEY_STDIN=1;;
        --reset-profile) RESET_PROFILE=--reset-profile;;
        *) die 'Неизвестный параметр установки.';;
      esac
      shift
    done
    if [ "$CMD" = install-only ]; then install_vpn "$RESET_PROFILE"; else setup_vpn; fi;;
  on|off|status|test|list|select|update|logs)
    owned_dir "$BASE"; owned_dir "$BASE/private"
    [ -f "$BASE/vpn-bigsur.py" ] || die 'Сначала выполните install.'
    exec "$PYTHON" -E -s "$BASE/vpn-bigsur.py" "$CMD" "$@";;
  uninstall)
    owned_dir "$BASE"; owned_dir "$BASE/private"
    [ -f "$BASE/VERSION" ] && [ -f "$BASE/vpn-bigsur.py" ] || die 'Установка не найдена; ничего не удаляю.'
    "$PYTHON" -E -s "$BASE/vpn-bigsur.py" off
    if [ -L "$COMMAND" ] && [ "$(/usr/bin/readlink "$COMMAND")" = "$BASE/vpn-bigsur.sh" ]; then /bin/rm "$COMMAND"; fi
    /bin/rm -rf "$BASE"
    say 'BigSurVPN удалён вместе с локальными профилями.';;
  *) help_text; die 'Неизвестная команда.';;
esac
