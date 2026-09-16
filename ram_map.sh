#!/bin/bash
# RAM corruption mapping test for macOS / Internet Recovery.
# Non-destructive to internal SSD. Continues after mismatches to build an error map.
set +u
export LC_ALL=C
LOG='/tmp/ram-map.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
fail(){ say "STOP: $*"; exit 1; }
for c in perl sysctl tee awk date; do command -v "$c" >/dev/null 2>&1 || fail "missing command: $c"; done

TOTAL_BYTES=$(sysctl -n hw.memsize 2>/dev/null)
case "$TOTAL_BYTES" in ''|*[!0-9]*) fail 'hw.memsize unavailable';; esac
TOTAL_MIB=$((TOTAL_BYTES/1048576))
TEST_MIB=8192
[ "$TOTAL_MIB" -lt 16384 ] && TEST_MIB=$((TOTAL_MIB/3))
TEST_MIB=$((TEST_MIB/32*32))
BOOT=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \([0-9][0-9]*\).*/\1/p' | sed -n '1p')
[ -n "$BOOT" ] || BOOT=0

say '============================================================'
say 'MODE=RAM_ERROR_MAPPING_V1'
say "BOOT_EPOCH=$BOOT TOTAL_RAM_MIB=$TOTAL_MIB TEST_MIB=$TEST_MIB"
say 'INTERNAL_SSD_WRITE=NONE'
say 'NOTE=reported test pages are virtual/allocation-relative, not physical DRAM addresses.'
say '============================================================'

perl - "$TEST_MIB" <<'PERL' 2>&1 | tee -a "$LOG"
use strict;
use warnings;
$|=1;
my $target_mib=shift @ARGV;
my $chunk_mib=32;
my $chunk_bytes=$chunk_mib*1024*1024;
my $pages_per_chunk=$chunk_bytes/4096;
my $chunks=int($target_mib/$chunk_mib);
my @mem;
my $total_errors=0;
my $events=0;
my %by_bit;
my %by_actual;
my %by_chunk;

sub page_for {
  my ($mode,$pageid)=@_;
  return "\xff" x 4096 if $mode eq 'ONES';
  return "\x00" x 4096 if $mode eq 'ZERO';
  return "\xaa\x55" x 2048 if $mode eq 'AA55';
  return "\x55\xaa" x 2048 if $mode eq '55AA';
  my $lo=$pageid & 0xffffffff;
  my $inv=4294967295-$lo;
  my $t=$mode eq 'ADDRA'
    ? pack('V4',$lo,$inv,0xA5A5A5A5,0x5A5A5A5A)
    : pack('V4',$inv,$lo,0x3C3C3C3C,0xC3C3C3C3);
  return $t x 256;
}
sub make_chunk {
  my ($mode,$ci)=@_;
  return "\xff" x $chunk_bytes if $mode eq 'ONES';
  return "\x00" x $chunk_bytes if $mode eq 'ZERO';
  return "\xaa\x55" x ($chunk_bytes/2) if $mode eq 'AA55';
  return "\x55\xaa" x ($chunk_bytes/2) if $mode eq '55AA';
  my $b='';
  for my $p (0..$pages_per_chunk-1) { $b .= page_for($mode,$ci*$pages_per_chunk+$p); }
  return $b;
}
sub pop8 { my $x=shift; my $n=0; $n+=($x>>$_)&1 for 0..7; return $n; }
sub inspect_chunk {
  my ($mode,$cycle,$ci,$actual)=@_;
  my $badpages=0;
  for my $p (0..$pages_per_chunk-1) {
    my $pageid=$ci*$pages_per_chunk+$p;
    my $exp=page_for($mode,$pageid);
    my $got=substr($actual,$p*4096,4096);
    next if $got eq $exp;
    $badpages++;
    for my $j (0..4095) {
      my $e=ord(substr($exp,$j,1)); my $a=ord(substr($got,$j,1));
      next if $e==$a;
      my $xor=$e^$a;
      $total_errors++;
      $events++;
      $by_actual{sprintf('%02X',$a)}++;
      $by_chunk{$ci}++;
      for my $b (0..7) { $by_bit{$b}++ if $xor & (1<<$b); }
      if ($events <= 512) {
        printf "RAM_MAP_EVENT cycle=%d pattern=%s chunk=%d page=%d logical_test_page=%d byte=%d expected=%02X actual=%02X xor=%02X bit_errors=%d\n",
          $cycle,$mode,$ci,$p,$pageid,$j,$e,$a,$xor,pop8($xor);
      }
    }
  }
  return $badpages;
}

my @plan=(
  ['ONES',1],['ONES',2],['ONES',3],
  ['ZERO',1],['AA55',1],['55AA',1],['ADDRA',1],['ADDRB',1]
);
for my $step (@plan) {
  my ($mode,$cycle)=@$step;
  print "RAM_MAP_FILL cycle=$cycle pattern=$mode chunks=$chunks\n";
  for my $i (0..$chunks-1) {
    $mem[$i]=make_chunk($mode,$i);
    print "RAM_MAP_FILL_PROGRESS cycle=$cycle pattern=$mode chunk=$i/$chunks\n" if $i%32==0;
  }
  sleep 3;
  my $badpages=0;
  print "RAM_MAP_VERIFY cycle=$cycle pattern=$mode\n";
  for my $i (0..$chunks-1) {
    my $exp=make_chunk($mode,$i);
    if ($mem[$i] ne $exp) { $badpages += inspect_chunk($mode,$cycle,$i,$mem[$i]); }
    print "RAM_MAP_VERIFY_PROGRESS cycle=$cycle pattern=$mode chunk=$i/$chunks events=$events\n" if $i%32==0;
  }
  print "RAM_MAP_STEP_RESULT cycle=$cycle pattern=$mode bad_pages=$badpages byte_events=$events\n";
}
print "RAM_MAP_SUMMARY total_byte_events=$events\n";
print "RAM_MAP_BIT_COUNTS"; for my $b (0..7) { print " bit$b=".($by_bit{$b}||0); } print "\n";
my @chunks=sort {$by_chunk{$b}<=>$by_chunk{$a}} keys %by_chunk;
for my $i (0..$#chunks) { last if $i>=20; my $c=$chunks[$i]; print "RAM_MAP_HOT_CHUNK rank=".($i+1)." chunk=$c byte_events=$by_chunk{$c}\n"; }
print "RAM_MAP_FINAL=".($events?'FAIL':'PASS')."\n";
exit($events?2:0);
PERL
RC=${PIPESTATUS[0]:-99}

if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  TS=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)
  cp "$LOG" "/Volumes/RESCUE/RAM-MAP-$TS.log" 2>/dev/null || true
  say "LOG_SAVED=/Volumes/RESCUE/RAM-MAP-$TS.log"
fi

case "$RC" in
  0) say 'FINAL=PASS_NO_RAM_CORRUPTION_DETECTED'; exit 0;;
  2) say 'FINAL=FAIL_RAM_CORRUPTION_MAPPED'; exit 2;;
  *) say "FINAL=INCONCLUSIVE engine_exit=$RC"; exit 3;;
esac
