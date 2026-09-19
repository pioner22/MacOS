#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
use strict; use warnings;
my($path,$max)=@ARGV;
exit 3 unless defined($max) && $max =~ /^\d+$/ && $max>0 && $max<=2147483648;
binmode STDIN; binmode STDOUT;
$SIG{PIPE}='IGNORE';
my($total,$rc)=(0,0);
while(1){
  my $buf=''; my $n=sysread(STDIN,$buf,65536);
  if(!defined($n)){next if $!{EINTR}; $rc=3;last;}
  last unless $n;
  $total+=$n;
  if($total>$max){$rc=4;last;}
  my $off=0;
  while($off<$n){my $w=syswrite(STDOUT,$buf,$n-$off,$off); if(!defined($w)){next if $!{EINTR};$rc=3;last;} if(!$w){$rc=3;last;} $off+=$w;}
  last if $rc;
}
open my $f,'>',$path or exit 3;
print $f "$total\n" or exit 3; close $f or exit 3;
exit $rc;
