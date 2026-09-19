#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Exact byte count; bound excess response bodies. Handles EINTR and short writes.
use strict; use warnings; use Errno qw(EINTR);
my ($file,$limit)=@ARGV;
defined($limit) && $limit =~ /^\d+$/ && $limit>0 && $limit<=2147483648 or exit 3;
binmode STDIN; binmode STDOUT;
my $total=0;
while(1) {
    my $buf=''; my $n=sysread(STDIN,$buf,65536);
    if(!defined($n)) { next if $! == EINTR; die "read: $!"; }
    last if !$n;
    $total+=$n;
    if($total>$limit) { print STDERR "BODY_TOO_LONG=$total\n"; exit 4; }
    my $off=0;
    while($off<$n) {
        my $w=syswrite(STDOUT,$buf,$n-$off,$off);
        if(!defined($w)) { next if $! == EINTR; die "write: $!"; }
        $w>0 or die 'zero length write'; $off+=$w;
    }
}
open my $o,'>',$file or die "count: $!";
print $o "$total\n" or die "count write: $!";
close($o) or die "count close: $!";
close(STDOUT) or die "output close: $!";
