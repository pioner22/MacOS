#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Runtime registry: Bash 3.2 subset, fixed adapters, TSV data never evaluated.
REGISTRY_REVISION=2026-09-20.1
rg_clean(){ printf '%s' "$1" | LC_ALL=C tr -d '\000-\037\177' | awk '{printf "%s",substr($0,1,256)}'; }
rg_validate(){
  local key n file bytes
  REGISTRY_ERROR=REGISTRY_INVALID
  for key in devices profiles tools tests;do
    file="$ROOT/registry_$key.tsv"
    [ -f "$file" ] && [ ! -L "$file" ] || return 3
    bytes=$(wc -c < "$file") || return 3
    [ "$bytes" -gt 0 ] && [ "$bytes" -le 131072 ] || return 3
    case "$key" in devices|tools)n=5;;profiles)n=8;;tests)n=3;;esac
    LC_ALL=C awk -F '\t' -v k="$key" -v n="$n" '
      NF!=n{bad=1} {for(i=1;i<=NF;i++)if($i=="" || $i~/[\r\001-\010\013\014\016-\037\177]/ || length($i)>256)bad=1}
      k=="devices"{if($1!~/^[A-Za-z][A-Za-z0-9,._-]*$/ || $2!~/^[0-9][0-9][0-9][0-9]$/ || $5!="NOT_TESTED")bad=1; id=$1 SUBSEP $2}
      k=="profiles"{id=$1;if($1!~/^[a-z0-9._-]+$/ || $2!~/^[1-9][0-9]*$/ || length($2)>5 || $8!~/^(observe|screen|adaptive)$/)bad=1;for(i=3;i<=7;i++)if($i!~/^[A-Za-z0-9,._-]+$/)bad=1}
      k=="tools"{id=$1;for(i=1;i<=5;i++)if($i!~/^[A-Za-z0-9._-]+$/)bad=1}
      k=="tests"{id=$1;if($1!~/^[A-Z0-9_]+$/ || $2!~/^[a-z_]+$/ || $3!~/^(observe|network|read|write|stress|blocked)$/)bad=1}
      {if(seen[id]++)bad=1} END{exit (NR>0&&!bad)?0:3}' "$file" || return 3
    # awk counts an unterminated tail as a record; byte identity rejects it.
    n=$(awk '{n+=length($0)+1}END{print n}' "$file") || return 3
    [ "$n" -eq "$bytes" ] || return 3
  done
  REGISTRY_ERROR=NONE
}
rg_path(){
  local id=$1 path
  if [ "$KERNEL" = Darwin ];then
    case "$id" in bash)path=/bin/bash;;curl)path=/usr/bin/curl;;perl)path=/usr/bin/perl;;diskutil)path=/usr/sbin/diskutil;;
      awk)path=/usr/bin/awk;;tee)path=/usr/bin/tee;;openssl)path=/usr/bin/openssl;;shasum)path=/usr/bin/shasum;;sha256sum)return 1;;*)return 1;;esac
  else path=$(command -v "$id" 2>/dev/null) || return 1;fi
  [ -f "$path" ] && [ -x "$path" ] || return 1
  printf '%s\n' "$path"
}
rg_probe(){ pf_read "$@"; }
rg_add(){
  local row
  row=$(printf '%s\t%s\t%s\t%s\t%s\t%s' "$1" "$2" "$(rg_clean "${3:--}")" "$(rg_clean "${4:--}")" "$5" "$6") || return 3
  REGISTRY_CAPS="${REGISTRY_CAPS}${row}
"
}
rg_has(){
  printf '%s' "$REGISTRY_CAPS" | awk -F '\t' -v k="$1" '$1==k && ($2=="VERIFIED" || (k=="compiler"&&$2=="CANDIDATE")){yes=1} END{exit yes?0:1}'
}
rg_hash_probe(){
  local tool path got
  local -a cmd
  for tool in sha256sum shasum openssl;do
    path=$(rg_path "$tool") || continue
    case "$tool" in sha256sum)cmd=("$path");;shasum)cmd=("$path" -a 256);;openssl)cmd=("$path" dgst -sha256 -r);;esac
    got=$(rg_probe 5 /bin/bash -c 'printf abc | "$@"' rg "${cmd[@]}") || continue
    if [ "${got%% *}" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ];then
      DIAG_SHA_CMD=("${cmd[@]}");SHA_CMD=("${cmd[@]}");rg_add sha256 VERIFIED "$path" unknown KNOWN_ANSWER SHA256_ABC;return 0
    fi
  done
  DIAG_SHA_CMD=();rg_add sha256 UNUSABLE - unknown KNOWN_ANSWER NO_WORKING_SHA256
}
rg_version_ge(){
  case "$1:$2" in *[!0-9.:]*|:*)return 1;;esac
  awk -v a="$1" -v b="$2" 'BEGIN{na=split(a,x,".");nb=split(b,y,".");if(na<2||na>3||nb<2||nb>3)exit 1;for(i=1;i<=na;i++)if(x[i]!~/^[0-9]+$/)exit 1;for(i=1;i<=nb;i++)if(y[i]!~/^[0-9]+$/)exit 1;for(i=1;i<=3;i++){if(x[i]+0>y[i]+0)exit 0;if(x[i]+0<y[i]+0)exit 1}exit 0}'
}
rg_shell_family(){
  case "$1" in 3.2|3.2.*)printf bash32;;4.*|5.*)printf bash4plus;;*)printf unknown;;esac
}
registry_collect(){
  local id adapter tool probe source path out version state reason p
  REGISTRY_STATUS=INVALID;REGISTRY_CAPS='';REGISTRY_SELECTION=UNRESOLVED
  DIAG_CURL=;DIAG_PERL=;DIAG_DISKUTIL=;DIAG_SHA_CMD=()
  rg_validate || return 3
  REGISTRY_SHELL=$(rg_shell_family "$BASH_VERSION")
  while IFS=$'\t' read -r id adapter tool probe source;do
    state=MISSING;reason=TOOL_MISSING;path=-;version=unknown
    if [ "$id" = sha256 ];then rg_hash_probe;continue;fi
    if [ "$id" = compiler ];then
      if [ "${CAP_NATIVE:-no}" = candidate ] && [ -n "${CAP_CLANG:-}" ];then
        state=CANDIDATE;reason=BUILD_AND_MLOCK_NOT_PROBED;path=$CAP_CLANG
      fi
      rg_add "$id" "$state" "$path" "$version" TOOLCHAIN_CANDIDATE "$reason";continue
    fi
    if [ "$id" = bash_runtime ];then
      state=UNUSABLE;reason=BASH_VERSION_UNSUPPORTED
      if [ "$REGISTRY_SHELL" != unknown ] && ( a=(ok); false | true; ps=("${PIPESTATUS[@]}"); [ "${ps[0]}:${ps[1]}:${a[0]}" = 1:0:ok ] );then state=VERIFIED;reason=CURRENT_INTERPRETER_ARRAY_PIPESTATUS;fi
      rg_add "$id" "$state" "${BASH:-unknown}" "$BASH_VERSION" LIVE_INTERPRETER "$reason";continue
    fi
    p=$(rg_path "$tool") || { rg_add "$id" MISSING - unknown FILESYSTEM TOOL_MISSING;continue; }
    path=$p;state=UNUSABLE;reason=CAPABILITY_PROBE_FAILED
    case "$probe" in
      bash-system-subset)
        out=$(rg_probe 5 "$path" -c 'a=(ok); false | true; s=("${PIPESTATUS[@]}"); [ "${s[0]}:${s[1]}:${a[0]}" = 1:0:ok ] && printf "%s" "$BASH_VERSION"') || out=''
        version=$out
        if [ "$(rg_shell_family "$version")" != unknown ];then state=VERIFIED;reason=SYSTEM_INTERPRETER_ARRAY_PIPESTATUS;fi;;
      awk-tsv-numeric)
        out=$(rg_probe 5 "$path" -F '\t' 'BEGIN{n=split("a\t\tb",x,"\t");if(n==3 && x[2]=="" && 4294967296+1==4294967297)print "AWK_TSV_OK";else exit 3}') || out=''
        [ "$out" != AWK_TSV_OK ] || { state=VERIFIED;reason=TSV_EMPTY_FIELDS_AND_NUMERIC; };;
      tee-ignore-int)
        rg_probe 5 "$path" -i /dev/null >/dev/null && { state=VERIFIED;reason=OPTION_PROBE_NOT_SIGNAL_TEST; };;
      curl-https-options)
        out=$(rg_probe 5 "$path" -q --version) || out=''
        version=$(printf '%s\n' "$out" | sed -n '1s/^curl \([0-9][0-9.]*\).*/\1/p');[ -n "$version" ] || version=unknown
        if printf '%s\n' "$out" | grep -q '^Protocols:.*https' &&
           rg_probe 5 "$path" -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 120 --max-filesize 4096 --max-redirs 5 --speed-time 30 --speed-limit 1024 -H 'Accept-Encoding: identity' -D /dev/null -r 1-3 -w '%{http_code}' --help >/dev/null;then
          state=VERIFIED;reason=OPTIONS_ONLY_NETWORK_UNTESTED;DIAG_CURL=$path
        fi
        CURL_SIZE_GUARD=EXTERNAL_BYTE_CAP_REQUIRED
        if [ "$version" != unknown ];then
          if rg_version_ge "$version" 8.4.0;then reason=CURL_STREAM_CAP_EXPECTED_EXTERNAL_CAP_RETAINED
          else reason=CURL_HEADER_CAP_EXPECTED_EXTERNAL_CAP_REQUIRED;fi
          [ "$state" = VERIFIED ] || reason=CAPABILITY_PROBE_FAILED
        fi;;
      perl-pack32)
        out=$(rg_probe 5 "$path" -e 'print "$^V\n";exit(pack("V",0x12345678) eq "\x78\x56\x34\x12" ? 0:3)') && { state=VERIFIED;reason=PACK32_KNOWN_ANSWER;version=$out;DIAG_PERL=$path; };;
      perl-supervisor-modules)
        rg_probe 5 "$path" -MPOSIX -MIO::Select -MIO::Handle -e 'exit 0' >/dev/null && { state=VERIFIED;reason=MODULES_LOAD_NOT_PROCESS_STRESS; };;
      perl-file-modules)
        rg_probe 5 "$path" -MFcntl=O_NOFOLLOW -MFile::Temp=tempfile -MCwd=abs_path -MIO::Handle -MErrno -e 'exit 0' >/dev/null && { state=VERIFIED;reason=MODULES_ONLY_TARGET_NOT_OPENED; };;
      perl-64bit)
        rg_probe 5 "$path" -MConfig -e 'exit($Config{ivsize}>=8 ? 0:3)' >/dev/null && { state=VERIFIED;reason=INTEGER_WIDTH_ONLY; };;
      diskutil-root-plist)
        out=$(rg_probe 8 "$path" info -plist /) || out=''
        if printf '%s\n' "$out" | grep -q '<plist' && printf '%s\n' "$out" | grep -q '</plist>';then state=VERIFIED;reason=ROOT_PLIST_NOT_TARGET_IDENTITY;DIAG_DISKUTIL=$path;fi;;
      *) reason=UNKNOWN_PROBE_CONTRACT;;
    esac
    rg_add "$id" "$state" "$path" "$version" LOCAL_CAPABILITY_PROBE "$reason" || return 3
  done < "$ROOT/registry_tools.tsv"
  REGISTRY_STATUS=VALID
  # No optimistic fallback to old present-only flags after a failed capability probe.
  CAP_PERL=no;CAP_SUPERVISOR=no;CAP_SHA=no;CAP_CURL=no;CAP_FILE_PERL=no;CAP_DISKUTIL=no
  rg_has perl && CAP_PERL=yes
  rg_has perl_supervisor && CAP_SUPERVISOR=yes
  rg_has sha256 && CAP_SHA=yes
  rg_has curl && CAP_CURL=yes
  rg_has perl_file && CAP_FILE_PERL=yes
  rg_has diskutil && CAP_DISKUTIL=yes
  REGISTRY_DIGEST=$(hash_file "$ROOT/registry_profiles.tsv" 2>/dev/null) || REGISTRY_DIGEST=unavailable
  return 0
}
registry_resolve(){
  local chosen rc
  PROFILE_TEMPLATE=unknown-observation;PROFILE_POLICY=observe;REGISTRY_SELECTION=UNAVAILABLE
  if [ "$REGISTRY_STATUS" = VALID ];then
    chosen=$(awk -F '\t' -v h="$HW_PROFILE" -v e="$ENVIRONMENT" -v o="$OS_KEY" -v b="$OS_BUILD" -v sh="$REGISTRY_SHELL" '
      ($3=="any"||$3==h)&&($4=="any"||$4==e)&&($5=="any"||$5==o)&&($6=="any"||$6==b)&&($7=="any"||$7==sh) {
        if($2+0>top){top=$2+0;n=1;id=$1;policy=$8}else if($2+0==top)n++
      } END{if(n==1)print id "\t" policy;else exit 3}' "$ROOT/registry_profiles.tsv");rc=$?
    if [ "$rc" = 0 ];then IFS=$'\t' read -r PROFILE_TEMPLATE PROFILE_POLICY <<< "$chosen";REGISTRY_SELECTION=MATCHED
    else REGISTRY_SELECTION=AMBIGUOUS_OR_MISSING;fi
  fi
  if ! rg_has bash_runtime || ! rg_has bash_system || ! rg_has awk || ! rg_has tee || [ "$KERNEL" != Darwin ] || [ "${MODEL_PROFILE:-auto}" = limited ] || [ "${ENV_PROFILE:-auto}" = limited ] || [ "${OS_PROFILE:-auto}" = other ];then PROFILE_POLICY=observe;fi
  PROFILE_ID="$PROFILE_TEMPLATE.$OS_KEY.$ARCH.${CONSOLE:-unknown}.$REGISTRY_SHELL"
  PROFILE_VALIDATION=SOFTWARE_TESTED_REAL_HARDWARE_PENDING
  RAM_BACKEND=unavailable;FILE_BACKEND=unavailable;CPU_BACKEND=unavailable;GPU_BACKEND=inventory
  if [ "$PROFILE_POLICY" != observe ] && [ "$CAP_SUPERVISOR" = yes ];then
    if [ "$PROFILE_POLICY" = adaptive ] && [ "$CAP_NATIVE" = candidate ] && [ "$CPU" = intel ] && [ "$OS_KEY" != other ] && rg_has compiler;then
      RAM_BACKEND=native_candidate;FILE_BACKEND=native_candidate
    elif [ "$CAP_PERL" = yes ];then
      RAM_BACKEND=perl_screen;[ "$CAP_FILE_PERL" != yes ] || FILE_BACKEND=perl_file_screen
    fi
    [ "$CAP_SHA" != yes ] || CPU_BACKEND=sha_path
    if [ "$ENVIRONMENT" = full ] && [ "$CPU" = intel ] && [ "$CAP_NATIVE" = candidate ] && [ "$CAP_METAL" = present ] && rg_has compiler;then GPU_BACKEND=metal_candidate;fi
  fi
}
# Output is a plan, never test results or consent. Device year is documentary only.
registry_show(){
  printf 'REGISTRY_REVISION=%s STATUS=%s SELECTION=%s SHELL_FAMILY=%s\n' "$REGISTRY_REVISION" "${REGISTRY_STATUS:-UNAVAILABLE}" "${REGISTRY_SELECTION:-UNAVAILABLE}" "${REGISTRY_SHELL:-unknown}"
  awk -F '\t' -v m="$MODEL" '$1==m{print "DEVICE_REFERENCE year=" $2 " name=" $3 " validation=" $5;n++}END{if(!n)print "DEVICE_REFERENCE=UNKNOWN";else if(n>1)print "DEVICE_YEAR=AMBIGUOUS"}' "$ROOT/registry_devices.tsv"
  say 'RU: Реестр — ожидания; пробы — наблюдения. Год не задаёт Bash. READY не означает PASS.'
  say 'EN: Registry expectations differ from live probes. Year does not select Bash; READY is not PASS.'
}
registry_decision(){
  local stage=$1 family risk requires cap backend
  REGISTRY_DECISION=UNAVAILABLE;REGISTRY_REASON=TEST_NOT_IN_REGISTRY;REGISTRY_BACKEND=none
  family=$(awk -F '\t' -v s="$stage" '$1==s{print $2}' "$ROOT/registry_tests.tsv") || return 3
  case "$family" in
    raw)REGISTRY_DECISION=BLOCKED;REGISTRY_REASON=LEGACY_RAW_QUARANTINED;return 0;;
    toolkit|inventory|power|manual|support)REGISTRY_DECISION=READY;REGISTRY_REASON=OBSERVATION_OR_SOFTWARE_ONLY;REGISTRY_BACKEND=$family;return 0;;
  esac
  [ "$REGISTRY_STATUS" = VALID ] && [ "$REGISTRY_SELECTION" = MATCHED ] || { REGISTRY_REASON=REGISTRY_INVALID_OR_AMBIGUOUS;return 0; }
  rg_has bash_runtime && rg_has bash_system && rg_has awk && rg_has tee || { REGISTRY_REASON=BASH_CAPABILITY_UNAVAILABLE;return 0; }
  requires='';backend=none
  case "$family" in
    ram|ram_map)backend=$RAM_BACKEND;requires='perl perl_supervisor';[ "$family:$backend" != ram_map:perl_screen ] || { REGISTRY_REASON=RAM_MAP_REQUIRES_NATIVE;return 0; };[ "$backend" != native_candidate ] || requires="$requires compiler";;
    cpu)backend=$CPU_BACKEND;requires='perl perl_supervisor sha256';;
    gpu)backend=$GPU_BACKEND;requires='perl_supervisor compiler';[ "$backend" != inventory ] || { REGISTRY_REASON=GPU_NATIVE_UNAVAILABLE;return 0; };;
    network)backend=curl;requires='curl';;
    download)backend=stream;requires='curl perl perl_supervisor sha256';;
    file)backend=$FILE_BACKEND;requires='perl perl_supervisor perl_file';[ "$backend" != native_candidate ] || requires="$requires compiler";;
    readonly)backend=readonly;requires='perl perl_supervisor perl_file perl64 diskutil';[ "$PROFILE_POLICY" != observe ] || { REGISTRY_REASON=READONLY_PROFILE_UNAVAILABLE;return 0; };;
    *)return 0;;
  esac
  case "$backend" in unavailable|none)REGISTRY_REASON=BACKEND_UNAVAILABLE;return 0;;esac
  for cap in $requires;do rg_has "$cap" || { REGISTRY_REASON="CAPABILITY_UNAVAILABLE_$(printf '%s' "$cap" | tr 'a-z' 'A-Z')";return 0; };done
  REGISTRY_BACKEND=$backend;REGISTRY_DECISION=READY;REGISTRY_REASON=LIVE_CAPABILITIES_PRECHECK_ONLY
  case "$backend" in perl_screen|perl_file_screen)REGISTRY_DECISION=LIMITED;REGISTRY_REASON=SCREENING_NOT_HARDWARE_ACCEPTANCE;;esac
}
registry_gate(){
  # Unit-level callers may omit profile_detect. All public main/--engine paths detect live.
  [ -n "${REGISTRY_STATUS:-}" ] || return 0
  registry_decision "$1"
  printf 'DISPATCH stage=%s backend=%s state=%s reason=%s\n' "$1" "$REGISTRY_BACKEND" "$REGISTRY_DECISION" "$REGISTRY_REASON"
  case "$REGISTRY_DECISION" in READY|LIMITED)return 0;;BLOCKED)result BLOCKED 7 "$REGISTRY_REASON" "Тест запрещён политикой; нагрузка не запущена." "Policy blocks this test; no load started.";return 7;;*)unknown "$REGISTRY_REASON";return 3;;esac
}
registry_save(){
  local stage a b c
  [ -n "${REGISTRY_STATUS:-}" ] || return 0
  printf '%s' "$REGISTRY_CAPS" > "$SESSION/tool-capabilities.tsv" || return 3
  registry_show > "$SESSION/registry-selection.txt" || return 3
  for a in devices profiles tools tests;do
    b=$(hash_file "$ROOT/registry_$a.tsv") || b=UNAVAILABLE
    printf "%s\t%s\n" "$a" "$b"
  done > "$SESSION/registry-hashes.tsv" || return 3
  printf 'registry_revision\t%s\nprofile_digest\t%s\ncode_ref\t%s\n' "$REGISTRY_REVISION" "$REGISTRY_DIGEST" "${MACDIAG_CODE_REF:-LOCAL_UNPINNED}" > "$SESSION/registry-meta.tsv" || return 3
  : > "$SESSION/dispatch-plan.tsv" || return 3
  while IFS=$'\t' read -r stage a b;do
    registry_decision "$stage"
    printf '%s\t%s\t%s\t%s\n' "$stage" "$REGISTRY_DECISION" "$REGISTRY_BACKEND" "$REGISTRY_REASON" >> "$SESSION/dispatch-plan.tsv" || return 3
  done < "$ROOT/registry_tests.tsv"
}
registry_main(){ registry_show;printf '%s' "$REGISTRY_CAPS";cat "$SESSION/dispatch-plan.tsv";result OBSERVED 5 COMPATIBILITY_PLAN_ONLY 'Паспорт и план сохранены. Аппаратные тесты не запускались.' 'Profile and plan saved; no hardware tests started.'; }
