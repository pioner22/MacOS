#!/bin/bash
# Quick non-destructive RAM screening for macOS / Internet Recovery.
# On machines with enough RAM this covers 8 GiB so the previously observed
# ~5.4-6 GiB allocation-relative failure region is not skipped by the quick test.
set +u
export LC_ALL=C
LOG='/tmp/ram-quick.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
need(){ command -v "$1" >/dev/null 2>&1 || { say "ERROR_CODE=ENV_MISSING_TOOL tool=$1"; exit 3; }; }
for c in perl sysctl tee; do need "$c"; done
TOTAL=$(sysctl -n hw.memsize 2>/dev/null); case "$TOTAL" in ''|*[!0-9]*) say 'ERROR_CODE=ENV_NO_MEMSIZE'; exit 3;; esac
TOTAL_MIB=$((TOTAL/1048576))
TEST_MIB=8192
# Leave substantial room for Recovery on lower-memory Macs.
[ "$TOTAL_MIB" -lt 24576 ] && TEST_MIB=$((TOTAL_MIB/3))
TEST_MIB=$((TEST_MIB/32*32))
[ "$TEST_MIB" -ge 512 ] || { say 'RESULT=INCONCLUSIVE reason=insufficient_testable_memory'; exit 3; }
say 'MODE=RAM_QUICK_V2'; say "TOTAL_RAM_MIB=$TOTAL_MIB TEST_MIB=$TEST_MIB"; say 'INTERNAL_SSD_WRITE=NONE'
say 'RU: Быстрый скрининг RAM. На машине с достаточной памятью проверяется 8 GiB.'
say 'EN: Quick RAM screening. On sufficiently large systems, 8 GiB is tested.'

perl - "$TEST_MIB" <<'PERL' 2>&1 | tee -a "$LOG"
use strict; use warnings; $|=1;
my $mib=shift; my $cb=32*1024*1024; my $ppc=$cb/4096; my $chunks=int($mib/32); my @m; my $errs=0;
sub page {
  my($p,$id)=@_;
  return "\xff"x4096 if $p eq 'ONES';
  return "\x00"x4096 if $p eq 'ZERO';
  return "\xaa\x55"x2048 if $p eq 'AA55';
  my $lo=$id&0xffffffff; my $inv=4294967295-$lo;
  my $t=pack('V4',$lo,$inv,0xA5A5A5A5,0x5A5A5A5A);
  return $t x 256;
}
sub chunk {
  my($p,$ci)=@_;
  return "\xff"x$cb if $p eq 'ONES';
  return "\x00"x$cb if $p eq 'ZERO';
  return "\xaa\x55"x($cb/2) if $p eq 'AA55';
  my $b=''; for my $pg(0..$ppc-1){$b.=page($p,$ci*$ppc+$pg)} return $b;
}
sub locate_first {
  my($pat,$ci,$actual)=@_;
  for my $pg(0..$ppc-1) {
    my $id=$ci*$ppc+$pg; my $exp=page($pat,$id); my $got=substr($actual,$pg*4096,4096);
    next if $got eq $exp;
    for my $j(0..4095) {
      my $e=ord(substr($exp,$j,1)); my $a=ord(substr($got,$j,1));
      if($e!=$a){printf "RAM_QUICK_BAD_BYTE pattern=%s chunk=%d page=%d logical_test_page=%d byte=%d expected=%02X actual=%02X xor=%02X\n",$pat,$ci,$pg,$id,$j,$e,$a,$e^$a; return;}
    }
  }
}
for my $pat (qw(ONES ZERO AA55 ADDR)) {
 print "RAM_QUICK_FILL pattern=$pat chunks=$chunks\n";
 for my $i(0..$chunks-1){$m[$i]=chunk($pat,$i); print "RAM_QUICK_FILL_PROGRESS pattern=$pat chunk=$i/$chunks\n" if $i%32==0;}
 sleep 1;
 for my $i(0..$chunks-1){my $e=chunk($pat,$i); if($m[$i] ne $e){$errs++; print "RAM_QUICK_MISMATCH pattern=$pat chunk=$i\n"; locate_first($pat,$i,$m[$i]); last;} }
 print "RAM_QUICK_PATTERN_RESULT pattern=$pat errors=$errs\n"; exit 2 if $errs;
}
print "RAM_QUICK_FINAL=PASS\n"; exit 0;
PERL
RC=${PIPESTATUS[0]:-99}
case "$RC" in
 0) say 'RESULT=PASS'; say 'RU: Быстрый тест RAM не обнаружил повреждения данных в проверенной области.'; say 'EN: Quick RAM screening found no data corruption in the tested region.'; say 'NEXT_RU: Для высокой уверенности запустите Полный RAM тест.'; say 'NEXT_EN: Run the Full RAM test for higher confidence.'; exit 0;;
 2) say 'RESULT=FAIL'; say 'RU: Обнаружено реальное несовпадение записанных и считанных данных RAM.'; say 'EN: A real RAM write/read data mismatch was detected.'; say 'NEXT_RU: Холодная загрузка -> RAM MAP -> Полный RAM. До проверки памяти не считать зависимые hash/GPU/storage результаты достоверными.'; say 'NEXT_EN: Cold boot -> RAM MAP -> Full RAM. Do not trust dependent hash/GPU/storage results until memory is validated.'; exit 2;;
 *) say 'RESULT=INCONCLUSIVE'; say "RU: Тест RAM не завершён корректно (код $RC). Это не доказательство неисправности памяти."; say "EN: RAM test did not complete correctly (code $RC). This is not proof of bad RAM."; say 'NEXT_RU: Проверьте среду Recovery и повторите.'; say 'NEXT_EN: Check the Recovery environment and retry.'; exit 3;;
esac
