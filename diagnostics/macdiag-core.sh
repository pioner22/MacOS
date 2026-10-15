#!/bin/bash
# MacDiag Core 0.1.0 bootstrap. Default: local observation only, not VPN install.
# curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/macdiag-core.sh | bash
# Pinned components are verified before any downloaded code is executed.
macdiag_core_bootstrap() (
  set +x
  set -eu
  set -o pipefail
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export LC_ALL=C
  unset BASH_ENV ENV CDPATH PERL5OPT PERL5LIB PERLLIB PERL_UNICODE PYTHONPATH PYTHONHOME
  umask 077
  local origin work ref path expected got
  origin=$(pwd -P)
  cd /
  ref=5b2eecc9613c34f4844ced1b73d5650731d2ec2e
  if [ ! -x /usr/bin/perl ] || ! /usr/bin/env -i PATH="$PATH" LC_ALL=C /usr/bin/perl -f -e 'BEGIN { $SIG{ALRM}=sub{exit 2}; alarm 5 } eval { require Digest::SHA; 1 } or exit 2; alarm 0;' </dev/null >/dev/null 2>&1; then
    printf '%s\n' '{"schema":"macdiag.minimal.v1","engine":"UNAVAILABLE","reason":"SYSTEM_PERL_SHA256_MISSING","hardware_health":"UNKNOWN"}'
    exit 2
  fi
  work=$(/usr/bin/mktemp -d /tmp/macdiag-core.XXXXXX)
  trap '/bin/rm -rf "$work"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  /bin/mkdir -p "$work/macdiag_core/bin" "$work/macdiag_core/lib/MacDiag" "$work/macdiag_core/registry"
  printf '%s\n' 'MacDiag Core 0.1.0: загрузка проверенных компонентов с GitHub.' >&2
  while read -r path expected; do
    [ -n "$path" ] || continue
    printf '  %s\n' "$path" >&2
    (
      ulimit -f 2048
      /usr/bin/curl -q -4 -fLsS --proto '=https' --proto-redir '=https' \
        --proxy '' --noproxy '*' --connect-timeout 10 --max-time 90 --retry 1 \
        --max-filesize 1048576 --max-redirs 3 \
        "https://raw.githubusercontent.com/pioner22/MacOS/$ref/macdiag_core/$path" \
        -o "$work/macdiag_core/$path" </dev/null
    ) || { printf '%s\n' 'ОШИБКА: загрузка не завершена. Скачанные компоненты не запущены.' >&2; exit 1; }
    got=$(/usr/bin/env -i PATH="$PATH" LC_ALL=C /usr/bin/perl -f -MDigest::SHA -e \
      'open my $f,"<",$ARGV[0] or exit 1; binmode $f; my $s=Digest::SHA->new(256);$s->addfile($f);print $s->hexdigest;' \
      "$work/macdiag_core/$path" </dev/null)
    [ "$got" = "$expected" ] || { printf '%s\n' 'ОШИБКА: SHA-256 не совпадает. Выполнение отменено.' >&2; exit 1; }
  done <<'MANIFEST'
macdiag fa613ace67b2b7fd3e8b217595d5f544ecbd7d1138069b00c28525081601a743
bin/macdiag.pl 1b99715671ed3202238c6c84f61bb9db76511e2801064fb338fa9e88db8ac229
lib/MacDiag/Runner.pm 7f2fb1f1a7dbc4e948764689758290f6398d172255644751c5e1b61dfbc72148
lib/MacDiag/Registry.pm 88b496549d38e57c3b0fc36a91f217319364d2b337ec7e450a29f0ff7e062bf6
lib/MacDiag/Detect.pm a1d46a0f9602701e41ece2c2556d1655d4c4eec458682677cfceabdd1f596c53
lib/MacDiag/Adapters.pm f6aee8cf106bebafc1514c9abfc05b8a3521b472802a861b3bc49c17d2d6b097
registry/catalog.json eefb18a7a4eab5fe1cf9032c5bfd34dfe54300aea5c7284d21a12478919d489e
MANIFEST
  if [ "$#" -eq 0 ]; then set -- profile collect; fi
  printf '%s\n' 'Компоненты проверены. По умолчанию: только паспорт среды, без sudo и изменения настроек.' >&2
  cd "$origin"
  /bin/bash "$work/macdiag_core/macdiag" "$@" </dev/null
)
# Keep the call last: an incomplete function body cannot perform installation.
macdiag_core_bootstrap "$@"
