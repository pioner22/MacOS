#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Core-Perl fallback: bounded virtual-allocation screening, NEVER all-DRAM PASS.
use strict;
use warnings;
$|=1;
my ($mib,$rounds)=@ARGV;
exit 3 unless defined $rounds && $mib=~/^\d+$/ && $rounds=~/^\d+$/ && $mib>=1 && $mib<=1024 && $rounds>=1 && $rounds<=3;
$SIG{INT}=sub{print "SCREEN_INTERRUPTED=INT\n";exit 130};
$SIG{TERM}=sub{print "SCREEN_INTERRUPTED=TERM\n";exit 143};
$SIG{HUP}=sub{print "SCREEN_INTERRUPTED=HUP\n";exit 129};
$SIG{ALRM}=sub{print "SCREEN_TIMEOUT=1\n";exit 3};alarm 1800;
my $page=4096;my $block=1048576;my @buf;
my @seeds=(0xffffffff,0,0xaa55aa55,0x55aa55aa,0xa5a5a5a5,0x5a5a5a5a);
sub expected {
  my ($p,$s,$r)=@_;
  return pack('V4',$p,0xffffffff-$p,$s,$r^0x13579bdf) x 256;
}
print "RAM_ENGINE=RECOVERY_CORE_PERL test_mib=$mib rounds=$rounds mlock=UNAVAILABLE physical_coverage=UNKNOWN\n";
print "RAM_SCOPE=VIRTUAL_SCREEN paging_compression_cache=NOT_EXCLUDED\n";
for my $r(0..$rounds-1){
 for my $s(@seeds){
  for my $b(0..$mib-1){
   my $v='';
   for my $p(0..255){$v.=expected($b*256+$p,$s,$r)}
   $buf[$b]=$v;
   print "RAM_SCREEN_FILL block=".($b+1)."/$mib round=".($r+1)." seed=$s\n" if ($b+1)%64==0;
  }
  sleep 1;
  for my $b(0..$mib-1){
   for my $p(0..255){
    my $off=$p*$page;my $e=expected($b*256+$p,$s,$r);my $a=substr($buf[$b],$off,$page);
    if($a ne $e){
     for my $i(0..$page-1){
      next if substr($a,$i,1) eq substr($e,$i,1);
      my $address=$b*$block+$off+$i;
      printf "RAM_SCREEN_MISMATCH allocation_byte=%d expected=%02X actual=%02X attribution=UNCONFIRMED\n",$address,ord(substr($e,$i,1)),ord(substr($a,$i,1));
      for my $n(1..3){printf "RAM_SCREEN_REREAD n=%d actual=%02X\n",$n,ord(substr($buf[$b],$off+$i,1))}
      exit 2;
     }
     print "RAM_SCREEN_LENGTH_MISMATCH\n";exit 2;
    }
   }
  }
  print "RAM_SCREEN_PATTERN_COMPLETE seed=$s round=".($r+1)."\n";
 }
}
alarm 0;
print "ENGINE_COMPLETE=RAM_SCREEN_CLEAN\n";
print "FULL_RAM_ACCEPTANCE=NOT_ESTABLISHED\n";
exit 0;
