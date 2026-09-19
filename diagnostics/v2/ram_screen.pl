#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Interpreter screening only, not a replacement for the native acceptance test.
use strict; use warnings; $|=1;
my($mib)=@ARGV;
exit 3 unless defined($mib)&&$mib=~/^\d+$/&&$mib>=8&&$mib<=2048;
my @mem;my $bytes=1048576;my $errors=0;
for my $pat(255,0,170,85){
  for my $i(0..$mib-1){
    # Fill each actual scalar in-place; do not equate virtual bytes to DRAM coverage.
    $mem[$i]='';$mem[$i].=chr($pat)x$bytes;
    substr($mem[$i],0,1)=chr($pat);
  }
  sleep 1;
  for my $i(0..$mib-1){
    if(length($mem[$i])!=$bytes||$mem[$i] ne chr($pat)x$bytes){
      print "RAM_SCREEN_MISMATCH chunk=$i pattern=$pat attribution=UNCONFIRMED\n";
      $errors++;last;
    }
  }
  print "RAM_SCREEN_PATTERN pattern=$pat errors=$errors\n";
  last if $errors;
}
print "ENGINE_COMPLETE=RAM_SCREEN_".($errors?'MISMATCH':'CLEAN')."\n";
print "RAM_COVERAGE=INTERPRETER_SCREENING_ONLY mlock=UNAVAILABLE\n";
exit($errors?2:0);
