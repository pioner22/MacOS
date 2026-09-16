#!/bin/bash
# Extreme RAM-only diagnostic for Intel Mac / macOS Internet Recovery.
# Internal SSD writes: NONE. The COMPLETE_A SSD marker remains untouched.
# Includes large-allocation pattern tests and an optional 40GiB RAM->RESCUE->RAM SHA256 roundtrip.
set +u
export LC_ALL=C
VERSION='RAM_MAX_TORTURE_V3'

LOG='/tmp/ram-max.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
fail(){ say "STOP: $*"; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
for c in perl sysctl awk tee date df sync rm cat sed; do need "$c"; done

SHA_TOOL=''
if command -v sha256sum >/dev/null 2>&1; then SHA_TOOL=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA_TOOL=shasum
else fail 'no SHA-256 tool'; fi

TOTAL_BYTES=$(sysctl -n hw.memsize 2>/dev/null)
case "$TOTAL_BYTES" in ''|*[!0-9]*) fail 'hw.memsize unavailable';; esac
TOTAL_MIB=$((TOTAL_BYTES/1048576))
BOOT=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \([0-9][0-9]*\).*/\1/p' | sed -n '1p')
[ -n "$BOOT" ] || BOOT=0
MAX_MIB=$((TOTAL_MIB*75/100))
[ "$MAX_MIB" -gt 49152 ] && MAX_MIB=49152
[ "$MAX_MIB" -lt 4096 ] && MAX_MIB=$((TOTAL_MIB/2))
RESERVE_MIB=$((TOTAL_MIB-MAX_MIB))

say '============================================================'
say "MODE=$VERSION"
say "BOOT_EPOCH=$BOOT"
say "TOTAL_RAM_MIB=$TOTAL_MIB MAX_SIMULTANEOUS_TEST_MIB=$MAX_MIB RESERVED_FOR_RECOVERY_MIB=$RESERVE_MIB"
say 'INTERNAL_SSD_WRITE=NONE'
say 'HARD_FAIL=data mismatch. Allocation/OOM/engine kill is INCONCLUSIVE, not proof of bad DRAM.'
say '============================================================'

snapshot_vm(){
  LABEL=$1
  if command -v vm_stat >/dev/null 2>&1; then
    say "VM_SNAPSHOT=$LABEL"
    vm_stat 2>/dev/null | sed -n '1,18p' | tee -a "$LOG"
  fi
  SWAP=$(sysctl -n vm.swapusage 2>/dev/null)
  [ -n "$SWAP" ] && say "SWAP_SNAPSHOT label=$LABEL $SWAP"
}

# run_phase LABEL MiB HOLD_SECONDS PATTERN_CSV
run_phase(){
  LABEL=$1; MIB=$2; HOLD=$3; PATTERNS=$4
  [ "$MIB" -gt "$MAX_MIB" ] && MIB=$MAX_MIB
  # 32 MiB alignment
  MIB=$((MIB/32*32))
  snapshot_vm "BEFORE_$LABEL"
  say "RAM_PHASE_START label=$LABEL target_mib=$MIB hold=$HOLD patterns=$PATTERNS"
  PHLOG="/tmp/ram-phase-$$.log"
  rm -f "$PHLOG"
  perl - "$LABEL" "$MIB" "$HOLD" "$PATTERNS" 2>"$PHLOG" <<'PERL'
use strict;
use warnings;
$|=1;
my ($label,$target_mib,$hold,$patcsv)=@ARGV;
my @patterns=split(/,/,$patcsv);
my $chunk_mib=32;
my $chunk_bytes=$chunk_mib*1024*1024;
my $pages_per_chunk=int($chunk_bytes/4096);
my $chunks=int($target_mib/$chunk_mib);
my @mem;
my $errors=0;
my $printed=0;

sub token {
  my ($mode,$pageid)=@_;
  my $lo=$pageid & 0xffffffff;
  my $inv=4294967295-$lo;
  return $mode eq 'ADDRA'
    ? pack('V4',$lo,$inv,0xA5A5A5A5,0x5A5A5A5A)
    : pack('V4',$inv,$lo,0x3C3C3C3C,0xC3C3C3C3);
}
sub expected_page {
  my ($mode,$pageid)=@_;
  return "\x00" x 4096 if $mode eq 'ZERO';
  return "\xff" x 4096 if $mode eq 'ONES';
  return "\xaa\x55" x 2048 if $mode eq 'AA55';
  return "\x55\xaa" x 2048 if $mode eq '55AA';
  return "\x01\x02\x04\x08\x10\x20\x40\x80" x 512 if $mode eq 'WALK1';
  return "\xfe\xfd\xfb\xf7\xef\xdf\xbf\x7f" x 512 if $mode eq 'WALK0';
  my $t=token($mode,$pageid);
  return $t x 256;
}
sub make_chunk {
  my ($mode,$ci)=@_;
  return "\x00" x $chunk_bytes if $mode eq 'ZERO';
  return "\xff" x $chunk_bytes if $mode eq 'ONES';
  return "\xaa\x55" x int($chunk_bytes/2) if $mode eq 'AA55';
  return "\x55\xaa" x int($chunk_bytes/2) if $mode eq '55AA';
  return "\x01\x02\x04\x08\x10\x20\x40\x80" x int($chunk_bytes/8) if $mode eq 'WALK1';
  return "\xfe\xfd\xfb\xf7\xef\xdf\xbf\x7f" x int($chunk_bytes/8) if $mode eq 'WALK0';
  my $b='';
  for (my $p=0;$p<$pages_per_chunk;$p++) {
    my $t=token($mode,$ci*$pages_per_chunk+$p);
    $b .= $t x 256;
  }
  return $b;
}
sub diagnose_chunk {
  my ($mode,$ci,$actual)=@_;
  my $found=0;
  for (my $p=0;$p<$pages_per_chunk;$p++) {
    my $pageid=$ci*$pages_per_chunk+$p;
    my $exp=expected_page($mode,$pageid);
    my $got=substr($actual,$p*4096,4096);
    next if $got eq $exp;
    $found++;
    my ($first,$ev,$av,$diff)=(-1,-1,-1,0);
    for (my $j=0;$j<4096;$j++) {
      my $e=ord(substr($exp,$j,1)); my $a=ord(substr($got,$j,1));
      if ($e != $a) { $diff++; if ($first < 0) {($first,$ev,$av)=($j,$e,$a);} }
    }
    print STDERR "$label RAM_BAD_PAGE pattern=$mode chunk=$ci page=$p logical_test_page=$pageid differing_bytes=$diff first_byte=$first expected_hex=".sprintf('%02X',$ev)." actual_hex=".sprintf('%02X',$av)."\n";
    for my $r (1..8) {
      my $again=substr($mem[$ci],$p*4096,4096);
      print STDERR "$label RAM_BAD_PAGE_REREAD pattern=$mode chunk=$ci page=$p repeat=$r result=".(($again eq $exp)?'PASS':'FAIL')."\n";
    }
    last if $found >= 8;
  }
  return $found;
}

print STDERR "$label RAM_ENGINE chunks=$chunks chunk_mib=$chunk_mib target_mib=$target_mib patterns=".scalar(@patterns)."\n";
for my $mode (@patterns) {
  print STDERR "$label RAM_FILL pattern=$mode\n";
  for (my $i=0;$i<$chunks;$i++) {
    my $v;
    my $ok=eval { $v=make_chunk($mode,$i); 1; };
    if (!$ok) { print STDERR "$label RAM_ALLOCATION_ERROR pattern=$mode chunk=$i error=$@\n"; exit 3; }
    $mem[$i]=$v;
    print STDERR "$label RAM_FILL_PROGRESS pattern=$mode chunk=$i/$chunks\n" if (($i % 32)==0);
  }
  print STDERR "$label RAM_HOLD pattern=$mode seconds=$hold\n";
  sleep($hold) if $hold;
  print STDERR "$label RAM_VERIFY pattern=$mode\n";
  for (my $i=0;$i<$chunks;$i++) {
    my $exp=make_chunk($mode,$i);
    if ($mem[$i] ne $exp) {
      print STDERR "$label RAM_CHUNK_MISMATCH pattern=$mode chunk=$i\n";
      my $n=diagnose_chunk($mode,$i,$mem[$i]);
      $errors += $n ? $n : 1;
    }
    print STDERR "$label RAM_VERIFY_PROGRESS pattern=$mode chunk=$i/$chunks errors=$errors\n" if (($i % 32)==0);
  }
  print STDERR "$label RAM_PATTERN_RESULT pattern=$mode errors=$errors\n";
  exit 2 if $errors;
}
@mem=();
print STDERR "$label RAM_PHASE_RESULT=PASS tested_mib=$target_mib patterns=".scalar(@patterns)." errors=0\n";
exit 0;
PERL
  RC=$?
  cat "$PHLOG" | tee -a "$LOG"
  rm -f "$PHLOG"
  snapshot_vm "AFTER_$LABEL"
  case "$RC" in
    0) say "RAM_PHASE_PASS label=$LABEL"; return 0;;
    2) fail "RAM_HARD_FAIL label=$LABEL data_mismatch";;
    3) fail "RAM_INCONCLUSIVE label=$LABEL allocation_failure";;
    *) fail "RAM_INCONCLUSIVE label=$LABEL engine_exit=$RC";;
  esac
}

# 40 GiB end-to-end RAM -> external RESCUE -> readback test.
# RAM is verified against a deterministic pattern immediately before streaming and
# again after the complete 40 GiB write, while SHA256 covers the exact bytes sent.
run_bridge40(){
  BRIDGE_MIB=40960
  [ "$BRIDGE_MIB" -gt "$MAX_MIB" ] && BRIDGE_MIB=$MAX_MIB
  if [ ! -d /Volumes/RESCUE ] || [ ! -w /Volumes/RESCUE ]; then
    say 'RAM_DISK_BRIDGE=SKIP reason=RESCUE_not_mounted_or_not_writable'
    return 0
  fi
  FREE_KB=$(df -k /Volumes/RESCUE 2>/dev/null | awk 'NR==2{print $4}')
  case "$FREE_KB" in ''|*[!0-9]*) say 'RAM_DISK_BRIDGE=SKIP reason=free_space_unknown'; return 0;; esac
  NEED_KB=$(((BRIDGE_MIB+12288)*1024))
  if [ "$FREE_KB" -lt "$NEED_KB" ]; then
    say "RAM_DISK_BRIDGE=SKIP reason=insufficient_space free_kb=$FREE_KB need_kb=$NEED_KB"
    return 0
  fi

  FILE='/Volumes/RESCUE/RAM-BRIDGE-40G.bin'
  SRC='/tmp/ram-bridge-source.sha256'
  READ1='/tmp/ram-bridge-read1.sha256'
  READ2='/tmp/ram-bridge-read2.sha256'
  BLOG='/tmp/ram-bridge-writer.log'
  rm -f "$FILE" "$SRC" "$READ1" "$READ2" "$BLOG"
  snapshot_vm BRIDGE_BEFORE
  say "RAM_DISK_BRIDGE=START target_mib=$BRIDGE_MIB file=$FILE"

  # Binary payload goes to stdout only; all diagnostic text goes to stderr.
  case "$SHA_TOOL" in
    sha256sum)
      perl - "$BRIDGE_MIB" 2>"$BLOG" <<'PERL' | tee "$FILE" | sha256sum > "$SRC"
use strict;
use warnings;
$|=1;
binmode STDOUT;
my $target_mib=shift @ARGV;
my $chunk_mib=32;
my $chunk_bytes=$chunk_mib*1024*1024;
my $sub_bytes=1024*1024;
my $subs=$chunk_bytes/$sub_bytes;
my $chunks=int($target_mib/$chunk_mib);
my @mem;
sub subblock {
  my ($global_mib)=@_;
  my $lo=$global_mib & 0xffffffff;
  my $inv=4294967295-$lo;
  my $t=pack('V4',$lo,$inv,0x6D5A56A5,0xA5C3C35A);
  return $t x int($sub_bytes/16);
}
sub make_chunk {
  my ($ci)=@_;
  my $b='';
  for my $s (0..$subs-1) { $b .= subblock($ci*$chunk_mib+$s); }
  return $b;
}
print STDERR "BRIDGE_RAM_ALLOC chunks=$chunks target_mib=$target_mib\n";
for my $i (0..$chunks-1) {
  my $ok=eval { $mem[$i]=make_chunk($i); 1; };
  if (!$ok) { print STDERR "BRIDGE_RAM_ALLOCATION_ERROR chunk=$i error=$@\n"; exit 3; }
  print STDERR "BRIDGE_RAM_FILL_PROGRESS chunk=$i/$chunks\n" if (($i%64)==0);
}
print STDERR "BRIDGE_RAM_PREVERIFY=START\n";
for my $i (0..$chunks-1) {
  my $e=make_chunk($i);
  if ($mem[$i] ne $e) { print STDERR "BRIDGE_RAM_PREVERIFY_MISMATCH chunk=$i\n"; exit 2; }
}
print STDERR "BRIDGE_RAM_PREVERIFY=PASS\nBRIDGE_STREAM=START\n";
for my $i (0..$chunks-1) {
  print STDOUT $mem[$i] or die "stdout write failed: $!";
  print STDERR "BRIDGE_STREAM_PROGRESS chunk=$i/$chunks\n" if (($i%64)==0);
}
close STDOUT;
print STDERR "BRIDGE_RAM_POSTVERIFY=START\n";
for my $i (0..$chunks-1) {
  my $e=make_chunk($i);
  if ($mem[$i] ne $e) { print STDERR "BRIDGE_RAM_POSTVERIFY_MISMATCH chunk=$i\n"; exit 2; }
}
print STDERR "BRIDGE_RAM_POSTVERIFY=PASS\n";
exit 0;
PERL
      P=("${PIPESTATUS[@]}");;
    shasum)
      perl - "$BRIDGE_MIB" 2>"$BLOG" <<'PERL' | tee "$FILE" | shasum -a 256 > "$SRC"
use strict; use warnings; $|=1; binmode STDOUT;
my $target_mib=shift; my $chunk_mib=32; my $chunk_bytes=$chunk_mib*1024*1024; my $sub_bytes=1024*1024; my $subs=$chunk_bytes/$sub_bytes; my $chunks=int($target_mib/$chunk_mib); my @mem;
sub sb{my($g)=@_;my$l=$g&0xffffffff;my$i=4294967295-$l;my$t=pack('V4',$l,$i,0x6D5A56A5,0xA5C3C35A);return $t x int($sub_bytes/16)}
sub mc{my($c)=@_;my$b='';for my$s(0..$subs-1){$b.=sb($c*$chunk_mib+$s)}return$b}
print STDERR "BRIDGE_RAM_ALLOC chunks=$chunks target_mib=$target_mib\n";for my$i(0..$chunks-1){my$ok=eval{$mem[$i]=mc($i);1};if(!$ok){print STDERR "BRIDGE_RAM_ALLOCATION_ERROR chunk=$i error=$@\n";exit 3}}
for my$i(0..$chunks-1){my$e=mc($i);if($mem[$i] ne $e){print STDERR "BRIDGE_RAM_PREVERIFY_MISMATCH chunk=$i\n";exit 2}}print STDERR "BRIDGE_RAM_PREVERIFY=PASS\n";
for my$i(0..$chunks-1){print STDOUT $mem[$i] or die $!}close STDOUT;for my$i(0..$chunks-1){my$e=mc($i);if($mem[$i] ne $e){print STDERR "BRIDGE_RAM_POSTVERIFY_MISMATCH chunk=$i\n";exit 2}}print STDERR "BRIDGE_RAM_POSTVERIFY=PASS\n";exit 0;
PERL
      P=("${PIPESTATUS[@]}");;
  esac
  cat "$BLOG" | tee -a "$LOG"
  PRC=${P[0]:-99}; TRC=${P[1]:-99}; HRC=${P[2]:-99}
  [ "$PRC" -eq 0 ] || { [ "$PRC" -eq 2 ] && fail 'RAM_HARD_FAIL bridge_memory_mismatch'; fail "RAM_DISK_BRIDGE=INCONCLUSIVE writer_exit=$PRC"; }
  [ "$TRC" -eq 0 ] && [ "$HRC" -eq 0 ] || fail "RAM_DISK_BRIDGE=INCONCLUSIVE tee/hash rc=$TRC/$HRC"
  sync
  SRC_HASH=$(awk '{print $1}' "$SRC")
  say "RAM_DISK_BRIDGE_SOURCE_SHA256=$SRC_HASH"

  # Try to force a real storage round-trip by unmounting/remounting RESCUE.
  REMOUNT=SKIPPED
  if command -v diskutil >/dev/null 2>&1; then
    DEV=$(diskutil info /Volumes/RESCUE 2>/dev/null | awk -F: '/Device Identifier/{gsub(/[ \t]/,"",$2);print $2;exit}')
    if [ -n "$DEV" ]; then
      sync
      if diskutil unmount /Volumes/RESCUE >/dev/null 2>&1; then
        sleep 2
        if diskutil mount "/dev/$DEV" >/dev/null 2>&1; then REMOUNT=PASS; else REMOUNT=FAIL_MOUNT; fi
      else REMOUNT=FAIL_UNMOUNT; fi
    fi
  fi
  say "RAM_DISK_BRIDGE_REMOUNT=$REMOUNT"
  [ -f "$FILE" ] || fail 'RAM_DISK_BRIDGE=INCONCLUSIVE bridge file missing after remount'

  case "$SHA_TOOL" in
    sha256sum) sha256sum "$FILE" > "$READ1"; sha256sum "$FILE" > "$READ2";;
    shasum) shasum -a 256 "$FILE" > "$READ1"; shasum -a 256 "$FILE" > "$READ2";;
  esac
  R1=$(awk '{print $1}' "$READ1"); R2=$(awk '{print $1}' "$READ2")
  say "RAM_DISK_BRIDGE_READ1_SHA256=$R1"
  say "RAM_DISK_BRIDGE_READ2_SHA256=$R2"
  if [ "$SRC_HASH" != "$R1" ] || [ "$SRC_HASH" != "$R2" ]; then
    say 'RAM_DISK_BRIDGE=FAIL roundtrip_hash_mismatch'
    say 'Interpretation: RAM pre/post verification passed, so this implicates the external I/O/storage path more than DRAM.'
    return 4
  fi
  say 'RAM_DISK_BRIDGE=PASS source=read1=read2'
  rm -f "$FILE"; sync
  snapshot_vm BRIDGE_AFTER
  return 0
}

# Phase 0 deliberately reproduces the prior ONES failure several times after a cold boot.
run_phase REPRO_8G 8192 3 'ONES,ONES,ONES,ZERO,AA55,55AA,ADDRA,ADDRB' || exit 1
# Wider data-bus/address/coupling coverage.
run_phase WIDE_24G 24576 5 'WALK1,WALK0,AA55,55AA,ADDRA,ADDRB,ONES,ZERO' || exit 1
# Large population of physical pages, including a 20-second retention hold per pattern.
run_phase HEAVY_40G 40960 20 'ONES,ZERO,ADDRA,ADDRB,AA55,55AA' || exit 1
# Maximum safe pressure: ~75% of installed RAM, leaving ~16GiB to Recovery on this 64GiB Mac.
run_phase MAX_48G "$MAX_MIB" 30 'ADDRA,ADDRB,ONES,WALK1,WALK0' || exit 1

run_bridge40
BRC=$?
if [ "$BRC" -eq 4 ]; then
  say 'RAM_MEMORY_TESTS=PASS but external RAM->disk roundtrip failed; do not diagnose DRAM from the bridge failure alone.'
fi

say '============================================================'
say 'RAM_MAX_TORTURE_FINAL=PASS'
say 'RAM-only phases completed without a data mismatch through the maximum allocation.'
say 'A single clean boot does not erase the earlier mismatch; repeat this complete test after another cold reboot.'
say 'Recommended acceptance criterion before resuming SSD diagnosis: 3 cold boots with zero RAM mismatches.'
say 'INTERNAL_SSD_WRITE=NONE'
say '============================================================'

# Persist compact evidence externally when possible.
if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  OUT="/Volumes/RESCUE/RAM-MAX-PASS-boot-${BOOT}.log"
  cp "$LOG" "$OUT" 2>/dev/null || true
  say "RAM_LOG_SAVED=$OUT"
fi
exit 0
