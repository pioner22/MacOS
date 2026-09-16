#!/bin/bash
# Standalone RAM-only triage for macOS Internet Recovery.
# Does not write to the internal SSD. Designed after a real one-byte mismatch was observed.
set +u
export LC_ALL=C
LOG='/tmp/ram-triage.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
fail(){ say "STOP: $*"; exit 1; }
for c in perl sysctl awk tee; do command -v "$c" >/dev/null 2>&1 || fail "missing command: $c"; done

TOTAL_BYTES=$(sysctl -n hw.memsize 2>/dev/null)
case "$TOTAL_BYTES" in ''|*[!0-9]*) fail 'hw.memsize unavailable';; esac
TOTAL_MIB=$((TOTAL_BYTES/1048576))
say '============================================================'
say 'MODE=RAM_ONLY_TRIAGE_V2'
say "TOTAL_RAM_MIB=$TOTAL_MIB"
say 'INTERNAL_SSD_WRITE=NONE'
say 'Purpose: confirm/refute the prior one-byte RAM mismatch before resuming SSD SHA verification.'
say '============================================================'

# phase(label, MiB, comma-separated patterns)
run_phase(){
  LABEL=$1; MIB=$2; PATTERNS=$3
  say "RAM_PHASE_START label=$LABEL target_mib=$MIB patterns=$PATTERNS"
  perl - "$LABEL" "$MIB" "$PATTERNS" <<'PERL' | tee -a "$LOG"
use strict;
use warnings;
$|=1;
my ($label,$target_mib,$patcsv)=@ARGV;
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
  my $t=token($mode,$pageid);
  return $t x 256;
}
sub make_chunk {
  my ($mode,$ci)=@_;
  return "\x00" x $chunk_bytes if $mode eq 'ZERO';
  return "\xff" x $chunk_bytes if $mode eq 'ONES';
  return "\xaa\x55" x int($chunk_bytes/2) if $mode eq 'AA55';
  return "\x55\xaa" x int($chunk_bytes/2) if $mode eq '55AA';
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
    my $first=-1; my ($ev,$av)=(-1,-1); my $diff=0;
    for (my $j=0;$j<4096;$j++) {
      my $e=ord(substr($exp,$j,1)); my $a=ord(substr($got,$j,1));
      if ($e != $a) { $diff++; if ($first < 0) { $first=$j; $ev=$e; $av=$a; } }
    }
    print "$label RAM_BAD_PAGE pattern=$mode chunk=$ci page=$p logical_test_page=$pageid differing_bytes=$diff first_byte=$first expected_hex=".sprintf('%02X',$ev)." actual_hex=".sprintf('%02X',$av)."\n";
    # Re-read the same page five times without rewriting. If it changes between reads,
    # the instability is even stronger evidence than a persistent wrong value.
    for my $r (1..5) {
      my $again=substr($mem[$ci],$p*4096,4096);
      my $status=($again eq $exp)?'PASS':'FAIL';
      print "$label RAM_BAD_PAGE_REREAD pattern=$mode chunk=$ci page=$p repeat=$r result=$status\n";
    }
    last if $found >= 8;
  }
  return $found;
}

for my $mode (@patterns) {
  print "$label RAM_FILL pattern=$mode chunks=$chunks target_mib=$target_mib\n";
  for (my $i=0;$i<$chunks;$i++) {
    $mem[$i]=make_chunk($mode,$i);
    print "$label RAM_FILL_PROGRESS pattern=$mode chunk=$i/$chunks\n" if (($i % 32)==0);
  }
  sleep 2;
  print "$label RAM_VERIFY pattern=$mode\n";
  for (my $i=0;$i<$chunks;$i++) {
    my $exp=make_chunk($mode,$i);
    if ($mem[$i] ne $exp) {
      print "$label RAM_CHUNK_MISMATCH pattern=$mode chunk=$i\n";
      my $n=diagnose_chunk($mode,$i,$mem[$i]);
      $errors += $n ? $n : 1;
    }
    print "$label RAM_VERIFY_PROGRESS pattern=$mode chunk=$i/$chunks errors=$errors\n" if (($i % 32)==0);
  }
  print "$label RAM_PATTERN_RESULT pattern=$mode errors=$errors\n";
  if ($errors) {
    print "$label RAM_PHASE_RESULT=FAIL errors=$errors\n";
    exit 2;
  }
}
@mem=();
print "$label RAM_PHASE_RESULT=PASS tested_mib=$target_mib patterns=".scalar(@patterns)." errors=0\n";
exit 0;
PERL
  RC=${PIPESTATUS[0]:-99}
  [ "$RC" -eq 0 ] || return "$RC"
  return 0
}

# Three independent allocation sizes. Reallocation between phases encourages the VM
# allocator to hand us a different physical-page population on a 64 GiB machine.
run_phase PHASE1_8G 8192 'ONES,ZERO,AA55,55AA,ADDRA,ADDRB' || fail 'RAM_TRIAGE_FAIL phase=PHASE1_8G'
run_phase PHASE2_16G 16384 'ADDRA,ADDRB,ONES,ZERO' || fail 'RAM_TRIAGE_FAIL phase=PHASE2_16G'
run_phase PHASE3_24G 24576 'AA55,55AA,ADDRA,ADDRB' || fail 'RAM_TRIAGE_FAIL phase=PHASE3_24G'

say '============================================================'
say 'RAM_TRIAGE_FINAL=PASS'
say 'Three independent userspace allocations (8/16/24 GiB) completed without a mismatch.'
say 'This materially lowers, but cannot eliminate, the probability of intermittent DRAM failure.'
say 'No internal-SSD writes were performed.'
say '============================================================'
exit 0
