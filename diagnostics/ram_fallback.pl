#!/usr/bin/perl
# SPDX-License-Identifier: GPL-3.0-or-later
# Recovery fallback: userspace string-integrity screening, not a physical DRAM map.
use strict;
use warnings;
$|=1;
my ($mib,$rounds,$mode,$hold)=@ARGV;
for ($mib,$rounds,$hold) { defined($_) && /^\d+$/ or exit 3; }
$mib>=1 && $mib<=49152 && $rounds>=1 && $rounds<=16 && $hold<=60 or exit 3;
defined($mode) && $mode =~ /^(quick|full|map)$/ or exit 3;
$SIG{INT}=sub { exit 130 }; $SIG{TERM}=sub { exit 130 };
$SIG{ALRM}=sub { print "ENGINE_TIMEOUT=1\n"; exit 3 }; alarm 1800;
my $cb=1024*1024; # Keep transient verification allocations bounded.
my @mem;
my ($events,$comparisons)=(0,0);
sub chunk {
    my ($p,$ci,$round)=@_;
    return chr(255)x$cb if $p==0;
    return chr(0)x$cb if $p==1;
    return "\xaa\x55"x($cb/2) if $p==2;
    return "\x55\xaa"x($cb/2) if $p==3;
    if($p>=6) {
        my $v=1<<(($p-6)%8); $v^=255 if $p>=14;
        return chr($v)x$cb;
    }
    my $out='';
    for(my $pg=0;$pg<$cb/4096;$pg++) {
        my $id=$ci*($cb/4096)+$pg;
        my @v=($id,4294967295-$id,0xA5A5A5A5^$round,0x5A5A5A5A^$round);
        @v=map {$_^0xffffffff} @v if $p==5;
        $out.=pack('V4',@v)x256;
    }
    return $out;
}
print "RAM_ENGINE=PERL_SCREEN tested_mib=$mib mlock=0 physical_coverage=UNKNOWN\n";
print "RAM_SCOPE=USERSPACE_STRING_INTEGRITY copy_on_write_and_compression_not_excluded\n";
my $np=$mode eq 'full'?22:6;
for(my $r=0;$r<$rounds;$r++) {
    for(my $p=0;$p<$np;$p++) {
        print "RAM_FILL round=".($r+1)." pattern=$p\n";
        for(my $i=0;$i<$mib;$i++) {
            $mem[$i]=chunk($p,$i,$r);
            # Ensure each scalar is writable; this does not pin physical pages.
            my $first=substr($mem[$i],0,1);
            substr($mem[$i],0,1)=chr(ord($first)^1);
            substr($mem[$i],0,1)=$first;
        }
        sleep($hold);
        my $before=$events;
        for(my $step=0;$step<$mib;$step++) {
            my $i=$r%2?$mib-1-$step:$step;
            my $exp=chunk($p,$i,$r);
            $comparisons++;
            next if length($mem[$i])==$cb && $mem[$i] eq $exp;
            my $gotlen=length($mem[$i]);
            print "RAM_LENGTH_MISMATCH chunk=$i actual=$gotlen expected=$cb\n" if $gotlen!=$cb;
            my $found=0;
            for(my $j=0;$j<$cb;$j++) {
                my $actual=$j<$gotlen?ord(substr($mem[$i],$j,1)):-1;
                my $expected=ord(substr($exp,$j,1));
                next if $actual==$expected;
                $found++; $events++;
                if($events<=64) {
                    printf "RAM_MISMATCH round=%d pattern=%d allocation_byte=%d expected=%02X actual=%d\n",$r+1,$p,$i*$cb+$j,$expected,$actual;
                }
                if($mode ne 'map' || $events>=1024) {
                    print "ENGINE_COMPLETE=RAM_DATA_MISMATCH attribution=UNCONFIRMED\n"; exit 2;
                }
            }
            # A length-only or vanished mismatch must never turn into PASS.
            if(!$found) { $events++; print "RAM_UNSTABLE_OR_LENGTH_MISMATCH chunk=$i\n"; }
        }
        print "RAM_PATTERN_COMPLETE round=".($r+1)." pattern=$p byte_events=".($events-$before)."\n";
    }
}
print "RAM_SUMMARY byte_events=$events chunk_comparisons=$comparisons\n";
if($events) { print "ENGINE_COMPLETE=RAM_DATA_MISMATCH attribution=UNCONFIRMED\n"; exit 2; }
print "ENGINE_COMPLETE=RAM_PASS\n"; exit 0;
