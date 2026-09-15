#!/bin/bash
# Build a fresh macOS Sequoia 15.8 (24H23) installer on the internal disk's
# dedicated HFS+ partition, from Recovery. Bash 3.2 compatible.
#
# Two-stage design:
#   download  - safe to run from the currently booted installer; writes only to /Volumes/Apple
#   build     - ERASES /dev/disk0s3; run only after booting a different Recovery environment
#   status    - show current package/target state
#
# This script does NOT erase disk0 or disk0s2 and does NOT touch Time Machine disks.

set -u

VERSION="1.0.0"
URL='https://swcdn.apple.com/content/downloads/24/14/142-16660-A_CTI1XX4VYC/dwxnuxoud4401qcf8to49p8iq1ij987j1e/InstallAssistant.pkg'
EXPECTED_SIZE='15664077639'
WORK='/Volumes/Apple/Sequoia-15.8-24H23'
PKG="$WORK/InstallAssistant.pkg"
PART="$PKG.part"
EXPANDED="$WORK/expanded"
TARGET_DEV='/dev/disk0s3'

say() { printf '%s\n' "$*"; }
die() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "Required command missing: $1"
}

require_common() {
  need diskutil
  need stat
  need grep
  need awk
  need sed
  need find
  need mkdir
  need rm
  need mv
  need sleep
  need curl
  need pkgutil
  need hdiutil
  need caffeinate
  [ "${EUID:-$(id -u)}" = 0 ] || die 'Run from macOS Recovery as root; do not use sudo inside this script.'
}

apple_volume_ok() {
  [ -d /Volumes/Apple ] || die 'The large APFS target volume /Volumes/Apple is not mounted.'
  local info loc fs free
  info=$(diskutil info /Volumes/Apple) || die 'Cannot inspect /Volumes/Apple.'
  loc=$(printf '%s\n' "$info" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  fs=$(printf '%s\n' "$info" | awk -F: '/File System Personality/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  [ "$loc" = 'Internal' ] || die '/Volumes/Apple is not on the internal device.'
  case "$fs" in APFS*) ;; *) die '/Volumes/Apple is not APFS.';; esac
  free=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
  [ -n "$free" ] || die 'Cannot read free space on /Volumes/Apple.'
  # Need ample room for the 15.7 GB package plus the expanded installer app.
  [ "$free" -gt 41943040 ] || die 'Need at least 40 GiB free on /Volumes/Apple for download + expansion.'
}

start_caffeinate() {
  caffeinate -di -w $$ >/tmp/sequoia-builder-caffeinate.log 2>&1 &
  CAFFEINATE_PID=$!
}

stop_caffeinate() {
  if [ -n "${CAFFEINATE_PID:-}" ]; then
    kill "$CAFFEINATE_PID" 2>/dev/null || :
    wait "$CAFFEINATE_PID" 2>/dev/null || :
  fi
}

pkg_size() {
  stat -f '%z' "$1" 2>/dev/null || printf '0\n'
}

verify_pkg() {
  [ -f "$PKG" ] || die "Package is missing: $PKG"
  local size
  size=$(pkg_size "$PKG")
  say "PACKAGE_SIZE=$size expected=$EXPECTED_SIZE"
  [ "$size" = "$EXPECTED_SIZE" ] || die 'Package size does not match Sequoia 15.8 (24H23).'
  say 'Checking Apple package signature...'
  pkgutil --check-signature "$PKG" || die 'pkgutil rejected the package signature.'
  pkgutil --payload-files "$PKG" 2>/dev/null | grep -Fq 'Install macOS Sequoia.app' || die 'Package payload does not contain Install macOS Sequoia.app.'
  say 'PACKAGE_OK: expected size, readable package metadata, and signature check passed.'
}

download_pkg() {
  apple_volume_ok
  mkdir -p "$WORK" || die "Cannot create $WORK"
  chmod 700 "$WORK" 2>/dev/null || :

  if [ -f "$PKG" ]; then
    if [ "$(pkg_size "$PKG")" = "$EXPECTED_SIZE" ]; then
      say 'Complete-size package already exists; verifying it instead of downloading again.'
      verify_pkg
      return 0
    fi
    die 'A finalized package exists with the wrong size. Move it aside manually before retrying.'
  fi

  say 'Downloading macOS Sequoia 15.8 build 24H23 from Apple CDN.'
  say "Partial file: $PART"
  say 'Interrupted transfers are resumed on the next attempt when the CDN accepts Range requests.'

  local attempt rc size
  attempt=1
  while [ "$attempt" -le 40 ]; do
    size=$(pkg_size "$PART")
    say "DOWNLOAD_ATTEMPT=$attempt existing_bytes=$size"
    if [ "$size" -gt 0 ]; then
      curl -fL -C - --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    else
      curl -fL --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    fi
    rc=$?
    size=$(pkg_size "$PART")
    say "CURL_EXIT=$rc bytes=$size"
    if [ "$rc" = 0 ]; then
      [ "$size" = "$EXPECTED_SIZE" ] || die 'curl returned success but the downloaded size is unexpected.'
      mv "$PART" "$PKG" || die 'Cannot finalize downloaded package.'
      verify_pkg
      say "DOWNLOAD_OK: $PKG"
      return 0
    fi
    # If a resume attempt is rejected while a partial exists, stop rather than truncate it.
    [ "$rc" != 33 ] || die 'Server rejected resume. Partial file preserved; do not delete it yet.'
    attempt=$((attempt+1))
    [ "$attempt" -le 40 ] || break
    say 'Retrying in 5 seconds...'
    sleep 5
  done
  die 'Download did not complete after 40 attempts. Partial file was preserved.'
}

target_info() {
  diskutil info "$TARGET_DEV" 2>/dev/null
}

check_target() {
  local info loc whole size fs
  info=$(target_info) || die "$TARGET_DEV is not present. Check diskutil list before build."
  loc=$(printf '%s\n' "$info" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  whole=$(printf '%s\n' "$info" | awk -F: '/Part of Whole/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  size=$(printf '%s\n' "$info" | awk -F: '/Disk Size/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  fs=$(printf '%s\n' "$info" | awk -F: '/File System Personality/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  [ "$loc" = 'Internal' ] || die "$TARGET_DEV is not internal."
  [ "$whole" = 'disk0' ] || die "$TARGET_DEV is not part of disk0."
  case "$fs" in 'Journaled HFS+'|'Mac OS Extended'*) ;; *) die "$TARGET_DEV is not the dedicated HFS+ installer partition.";; esac
  say "TARGET_OK: $TARGET_DEV internal, part of disk0, size=$size"
}

ensure_not_booting_from_target() {
  local mp
  mp=$(diskutil info "$TARGET_DEV" 2>/dev/null | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
  if [ -n "$mp" ] && [ "$mp" != 'Not mounted' ]; then
    if hdiutil info 2>/dev/null | grep -F "$mp/" >/dev/null 2>&1; then
      die "Current Recovery appears to use files from $mp. Reboot into Internet Recovery first; do not erase the running installer source."
    fi
  fi
}

expand_app() {
  verify_pkg
  rm -rf "$EXPANDED" || die 'Cannot remove previous expansion directory.'
  say 'Expanding InstallAssistant.pkg; this can take several minutes...'
  pkgutil --expand-full "$PKG" "$EXPANDED" || die 'pkgutil --expand-full failed.'
  APP=$(find "$EXPANDED" -type d -name 'Install macOS Sequoia.app' -print | head -n 1)
  [ -n "$APP" ] && [ -d "$APP" ] || die 'Expanded package does not contain Install macOS Sequoia.app.'
  CIM="$APP/Contents/Resources/createinstallmedia"
  [ -x "$CIM" ] || die 'createinstallmedia is missing or not executable in the expanded app.'
  say "APP_OK: $APP"
}

build_installer() {
  apple_volume_ok
  check_target
  ensure_not_booting_from_target
  expand_app

  say ''
  say 'DESTRUCTIVE TARGET CHECK'
  say "The next step erases ONLY $TARGET_DEV (the ~70 GB internal installer partition)."
  say 'It does NOT erase disk0s2 /Volumes/Apple.'
  printf 'Type SEQUOIA to continue: '
  IFS= read -r answer
  [ "$answer" = 'SEQUOIA' ] || die 'Cancelled.'

  diskutil mount "$TARGET_DEV" >/dev/null 2>&1 || :
  MOUNT=$(diskutil info "$TARGET_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
  [ -n "$MOUNT" ] && [ "$MOUNT" != 'Not mounted' ] && [ -d "$MOUNT" ] || die 'Target partition is not mounted.'

  say "Running createinstallmedia against $MOUNT"
  "$CIM" --volume "$MOUNT" --nointeraction || die 'createinstallmedia failed.'

  say 'Verifying resulting internal installer...'
  diskutil info "$TARGET_DEV" || die 'Cannot inspect rebuilt target.'
  NEWMOUNT=$(diskutil info "$TARGET_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
  [ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || die 'Rebuilt installer is not mounted.'
  bless --info "$NEWMOUNT" || die 'bless does not recognize the rebuilt installer structure.'
  say 'BUILD_OK: fresh Sequoia installer created on internal disk0s3.'
  say 'Next: shut down, disconnect old USB installer, boot holding Option, choose Install macOS Sequoia, install to Apple.'
}

status() {
  say "SEQUOIA INTERNAL INSTALLER BUILDER $VERSION"
  if [ -d /Volumes/Apple ]; then
    say 'APPLE_VOLUME=MOUNTED'
  else
    say 'APPLE_VOLUME=NOT_MOUNTED'
  fi
  if [ -f "$PKG" ]; then
    say "PACKAGE=$PKG size=$(pkg_size "$PKG")"
  elif [ -f "$PART" ]; then
    say "PARTIAL=$PART size=$(pkg_size "$PART")"
  else
    say 'PACKAGE=NOT_DOWNLOADED'
  fi
  target_info || say "TARGET=$TARGET_DEV NOT_FOUND"
}

main() {
  require_common
  start_caffeinate
  trap stop_caffeinate EXIT INT TERM
  case "${1:-status}" in
    download) download_pkg ;;
    verify) apple_volume_ok; verify_pkg ;;
    build) build_installer ;;
    status) status ;;
    *) die 'Usage: bash sequoia-internal-installer.sh [download|verify|build|status]' ;;
  esac
}

main "$@"
